use crate::{commands::*, state::ProcessRegistry};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Notify;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long a cancelled ffmpeg gets to exit after SIGTERM before SIGKILL.
const GRACEFUL_EXIT: std::time::Duration = std::time::Duration::from_secs(5);

/// Payload pushed to the frontend via the global `ffmpeg:log` event.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogPayload {
    job_id: String,
    stream: &'static str, // "stdout" | "stderr"
    text: String,
}

/// `ffmpeg -version` probe (replaces runProbe).
pub async fn probe(ffmpeg: &str) -> ProbeResult {
    let mut cmd = Command::new(ffmpeg);
    cmd.arg("-version");
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            return ProbeResult {
                ok: false,
                code: None,
                version: None,
                error: Some(e.to_string()),
            }
        }
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let first_line = stdout.lines().next().unwrap_or("").to_owned();

    if out.status.success() {
        ProbeResult {
            ok: true,
            code: Some(out.status.code().unwrap_or(0)),
            version: Some(first_line),
            error: None,
        }
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        ProbeResult {
            ok: false,
            code: out.status.code(),
            version: Some(first_line),
            error: Some(if stderr.is_empty() {
                stdout.to_string()
            } else {
                stderr.to_string()
            }),
        }
    }
}

/// `ffmpeg <args>` conversion with live log streaming (replaces runConversion).
///
/// The `Child` lives in this scope. `cancel` signals through the registry's
/// `Notify`; this loop owns the terminate -> escalate -> reap sequence, so
/// signals only ever reach the child it spawned.
pub async fn run<R: tauri::Runtime>(
    app: &AppHandle<R>,
    registry: &ProcessRegistry,
    req: ConvertRequest,
) -> ConvertResult {
    // Atomic output: ffmpeg writes to `<stem>.zonevert-tmp<ext>` (same dir,
    // so the rename stays on one filesystem) and only a successful exit renames
    // it into place. Killed or failed runs leave nothing behind. The extension
    // MUST survive — ffmpeg infers the muxer from it, and `out.mp4.zonevert-tmp`
    // fails with "unable to choose an output format". Runs whose last arg is
    // not a plain output file (encoder validation's `-f null -`, pipes) skip
    // the swap entirely.
    let output_path = req.args.last().cloned();
    let temp_path = req
        .args
        .last()
        .and_then(|last| atomic_temp_path(last));
    let mut args = req.args.clone();
    if let Some(temp) = &temp_path {
        if let Some(last) = args.last_mut() {
            *last = temp.clone();
        }
    }

    let mut cmd = Command::new(resolve_ffmpeg(&req.ffmpeg_path));
    cmd.args(&args);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ConvertResult {
                ok: false,
                code: None,
                signal: None,
                error: Some(e.to_string()),
            }
        }
    };

    // Register PID + cancel signal. The Child stays here (it owns the
    // stdout/stderr readers and the wait() handle); cancel only notifies.
    let pid = child.id();
    let job_id = req.job_id.clone();
    let cancel = Arc::new(Notify::new());
    if let Some(pid) = pid {
        registry
            .0
            .lock()
            .await
            .insert(job_id.clone(), (pid, cancel.clone()));
    }

    // Take the stdout/stderr readers so we can stream them concurrently.
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");

    let app_clone = app.clone();
    let job_id_stdout = job_id.clone();
    let stdout_task = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 8192];
        loop {
            let n = match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            let text = String::from_utf8_lossy(&buf[..n]).to_string();
            let _ = app_clone.emit(
                "ffmpeg:log",
                LogPayload {
                    job_id: job_id_stdout.clone(),
                    stream: "stdout",
                    text,
                },
            );
        }
    });

    let app_clone = app.clone();
    let job_id_stderr = job_id.clone();
    let last_stderr = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
    let last_stderr_clone = last_stderr.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 8192];
        loop {
            let n = match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            let text = String::from_utf8_lossy(&buf[..n]).to_string();
            {
                let mut last = last_stderr_clone.lock().await;
                *last = text.lines().filter(|l| !l.trim().is_empty()).last()
                    .unwrap_or("").to_string();
            }
            let _ = app_clone.emit(
                "ffmpeg:log",
                LogPayload {
                    job_id: job_id_stderr.clone(),
                    stream: "stderr",
                    text,
                },
            );
        }
    });

    // The Child stays in this scope — wait() here, cancel signals via Notify.
    let status = tokio::select! {
        status = child.wait() => status,
        _ = cancel.notified() => {
            // Graceful: SIGTERM (ffmpeg treats it like 'q' and finalizes the
            // current output), then bounded escalation to SIGKILL for builds
            // that ignore or stall on SIGTERM. Every path reaps via wait().
            if let Some(pid) = child.id() {
                crate::state::kill_pid(pid);
            }
            match tokio::time::timeout(GRACEFUL_EXIT, child.wait()).await {
                Ok(status) => status,
                Err(_) => {
                    let _ = child.kill().await;
                    child.wait().await
                }
            }
        }
    };
    // Remove the registry entry BEFORE awaiting the reader tasks: the entry
    // must never outlive the reaped child, or a late cancel() could signal
    // an unrelated process that recycled the PID.
    registry.0.lock().await.remove(&job_id);
    // ponytail: bounded joins — a straggler grandchild holding the pipe write
    // end past the child's death must not hang the job forever. Upgrade path:
    // spawn ffmpeg in its own process group (setsid) and signal the group.
    let _ = tokio::time::timeout(GRACEFUL_EXIT, stdout_task).await;
    let _ = tokio::time::timeout(GRACEFUL_EXIT, stderr_task).await;
    let stderr_tail = last_stderr.lock().await.clone();

    let mut result = match status {
        Ok(s) if s.success() => ConvertResult {
            ok: true,
            code: s.code(),
            signal: None,
            error: None,
        },
        Ok(s) => ConvertResult {
            ok: false,
            code: s.code(),
            signal: signal_str(&s),
            error: Some(format!(
                "FFmpeg exited with code {}{}",
                s.code().unwrap_or(-1),
                if stderr_tail.is_empty() { String::new() } else { format!(": {}", stderr_tail) }
            )),
        },
        Err(e) => ConvertResult {
            ok: false,
            code: None,
            signal: None,
            error: Some(e.to_string()),
        },
    };

    if let (Some(temp), Some(final_path)) = (temp_path.as_deref(), output_path.as_deref()) {
        if result.ok {
            // Success: promote the temp file. A rename failure here means
            // ffmpeg claimed success without producing output — surface it
            // instead of letting a phantom "done" through.
            if let Err(e) = std::fs::rename(temp, final_path) {
                let _ = std::fs::remove_file(temp);
                result = ConvertResult {
                    ok: false,
                    code: None,
                    signal: None,
                    error: Some(format!("Output rename failed: {e}")),
                };
            }
        } else {
            // Failed or killed mid-run: no partial output for the user.
            let _ = std::fs::remove_file(temp);
        }
    }

    result
}

/// Temp path for atomic output: `/dir/clip.mp4` -> `/dir/clip.zonevert-tmp.mp4`.
///
/// Returns None when the argument isn't a plain output file — options (`-`,
/// `-foo`), pipes (`pipe:1`), or extension-less targets (ffmpeg can't infer a
/// muxer for those anyway). Those runs execute unwrapped.
pub fn atomic_temp_path(output: &str) -> Option<String> {
    if output.starts_with('-') {
        return None;
    }
    // String surgery, not Path: on Windows `Path::with_file_name` rewrites
    // '/' to '\\', producing mixed-separator paths like `/dir\out.mp4`.
    // ffmpeg tolerates those, but preserving the caller's separators keeps
    // the temp path identical in shape to the final one.
    let (dir, file) = match output.rfind(['/', '\\']) {
        Some(i) => (&output[..=i], &output[i + 1..]),
        None => ("", output),
    };
    let (stem, ext) = file.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    Some(format!("{dir}{stem}.zonevert-tmp.{ext}"))
}

/// `ffmpeg -hide_banner -encoders` -> encoder name list. Feeds the
/// frontend pre-flight check so users get "your FFmpeg has no libwebp
/// encoder" instead of a raw FFmpeg error mid-queue.
pub async fn encoders(ffmpeg_path: &str) -> Vec<String> {
    let mut cmd = Command::new(ffmpeg_path);
    cmd.arg("-hide_banner").arg("-encoders");
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    if !out.status.success() {
        return Vec::new();
    }
    parse_encoders(&String::from_utf8_lossy(&out.stdout))
}

/// Parse `ffmpeg -encoders` output. Encoder lines look like
/// ` V....D libwebp  libwebp WebP image (codec webp)` — token 0 is the
/// flag field (first char is the stream type V/A/S), token 1 the name.
/// Section headers ("Encoders:"), separators and blanks don't match.
fn parse_encoders(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut tokens = line.split_whitespace();
            let flags = tokens.next()?;
            let name = tokens.next()?;
            let is_flag_field = flags.len() >= 4
                && matches!(flags.as_bytes()[0], b'V' | b'A' | b'S')
                && flags
                    .bytes()
                    .skip(1)
                    .all(|b| b.is_ascii_uppercase() || b == b'.');
            is_flag_field.then(|| name.to_owned())
        })
        .collect()
}

// ---- media probe (ffprobe) ----

/// One probed stream, normalized for the frontend. Video streams that are
/// only cover art (`disposition.attached_pic = 1`) are filtered out by the
/// caller-visible rule in `probe_media`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStream {
    pub codec_type: String,
    pub codec_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pix_fmt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_rate: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    pub video: Option<MediaStream>,
    pub audio: Option<MediaStream>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ffprobe -of json shapes. Every field optional: ffprobe omits entries for
// streams that don't have them (audio has no width, images have no format
// duration).
#[derive(Deserialize)]
struct FfprobeDisposition {
    #[serde(default)]
    attached_pic: Option<u32>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    pix_fmt: Option<String>,
    #[serde(default)]
    r_frame_rate: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    disposition: Option<FfprobeDisposition>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    #[serde(default)]
    duration: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeJson {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    #[serde(default)]
    format: Option<FfprobeFormat>,
}

/// Full media inspection: duration + first real video stream + first audio
/// stream. `video` is None for audio files (even with cover art) and for
/// probe failures; callers classify via `video.is_some()`.
pub async fn probe_media(path: &str, ffmpeg_path: &Option<String>) -> MediaProbeResult {
    let ffprobe = resolve_ffprobe(ffmpeg_path);
    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels:stream_disposition=attached_pic",
        "-of",
        "json",
        path,
    ]);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            return MediaProbeResult {
                ok: false,
                duration: None,
                video: None,
                audio: None,
                error: Some(format!(
                    "Could not run ffprobe ({}): {}",
                    ffprobe, e
                )),
            }
        }
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return MediaProbeResult {
            ok: false,
            duration: None,
            video: None,
            audio: None,
            error: Some(if stderr.trim().is_empty() {
                format!("ffprobe exited with code {}", out.status.code().unwrap_or(-1))
            } else {
                stderr.trim().to_string()
            }),
        };
    }

    match parse_probe_json(&String::from_utf8_lossy(&out.stdout)) {
        Some(r) => r,
        None => MediaProbeResult {
            ok: false,
            duration: None,
            video: None,
            audio: None,
            error: Some("Could not parse ffprobe output.".into()),
        },
    }
}

/// Pure: ffprobe JSON → MediaProbeResult. Video stream selection skips
/// attached-pic (cover art) streams; first audio stream wins.
fn parse_probe_json(json: &str) -> Option<MediaProbeResult> {
    let parsed: FfprobeJson = serde_json::from_str(json).ok()?;

    let to_stream = |s: &FfprobeStream, codec_type: &str| MediaStream {
        codec_type: codec_type.to_string(),
        codec_name: s.codec_name.clone().unwrap_or_default(),
        width: s.width,
        height: s.height,
        pix_fmt: s.pix_fmt.clone(),
        frame_rate: s.r_frame_rate.as_deref().and_then(parse_frame_rate),
        sample_rate: s.sample_rate.as_deref().and_then(|v| v.parse().ok()),
        channels: s.channels,
    };

    let is_attached_pic = |s: &FfprobeStream| {
        s.disposition
            .as_ref()
            .and_then(|d| d.attached_pic)
            .unwrap_or(0)
            == 1
    };

    let video = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video") && !is_attached_pic(s))
        .map(|s| to_stream(s, "video"));
    let audio = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .map(|s| to_stream(s, "audio"));

    Some(MediaProbeResult {
        ok: true,
        duration: parsed
            .format
            .as_ref()
            .and_then(|f| f.duration.as_deref())
            .and_then(|d| d.parse::<f64>().ok())
            .filter(|d| d.is_finite() && *d > 0.0),
        video,
        audio,
        error: None,
    })
}

/// `"30000/1001"` → 29.97; `"0/0"` and garbage → None.
fn parse_frame_rate(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 || num == 0.0 {
        return None;
    }
    Some(num / den)
}

/// Resolve the ffprobe executable. Priority:
///   1. sibling of an explicit absolute ffmpeg path (`/opt/ff/ffmpeg` ->
///      `/opt/ff/ffprobe`, `.exe` aware) — users who point at a bundled or
///      custom build almost never have a bare `ffprobe` on PATH
///   2. `FFPROBE_PATH` env var
///   3. bare `ffprobe` (system PATH)
pub fn resolve_ffprobe(ffmpeg_path: &Option<String>) -> String {
    if let Some(p) = ffmpeg_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(sibling) = ffprobe_sibling(p) {
            return sibling;
        }
    }
    if let Ok(env) = std::env::var("FFPROBE_PATH") {
        if !env.trim().is_empty() {
            return env.trim().to_owned();
        }
    }
    "ffprobe".into()
}

/// Replace the final path component `ffmpeg[.exe]` with `ffprobe[.exe]`.
/// Only paths whose executable name starts with `ffmpeg` qualify; anything
/// else (e.g. a wrapper script named `convert`) falls through to PATH.
fn ffprobe_sibling(ffmpeg_path: &str) -> Option<String> {
    let (dir, file) = split_final_component(ffmpeg_path)?;
    let stem = file.strip_suffix(".exe").unwrap_or(&file);
    if !stem.starts_with("ffmpeg") {
        return None;
    }
    let ext = if file != stem { ".exe" } else { "" };
    let sep = separator_for(ffmpeg_path);
    match dir {
        Some(d) => Some(format!("{d}{sep}ffprobe{ext}")),
        None => Some(format!("ffprobe{ext}")),
    }
}

/// Split off the last path component (either separator style).
fn split_final_component(path: &str) -> Option<(Option<&str>, &str)> {
    let idx = path.rfind(['/', '\\'])?;
    let (dir, file) = (&path[..idx], &path[idx + 1..]);
    if file.is_empty() {
        return None;
    }
    Some((Some(dir), file))
}

fn separator_for(path: &str) -> char {
    if path.rfind('\\').unwrap_or(0) > path.rfind('/').unwrap_or(0) {
        '\\'
    } else {
        '/'
    }
}

/// `ffprobe` width/height probe (replaces ffprobe:run).
pub async fn probe_image(path: &str, ffmpeg_path: &Option<String>) -> ProbeImageResult {
    let mut cmd = Command::new(resolve_ffmpeg(ffmpeg_path));
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        path,
    ]);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            return ProbeImageResult {
                ok: false,
                width: None,
                height: None,
                error: Some(e.to_string()),
            }
        }
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return ProbeImageResult {
            ok: false,
            width: None,
            height: None,
            error: Some(if stderr.is_empty() {
                format!(
                    "ffprobe exited with code {}",
                    out.status.code().unwrap_or(-1)
                )
            } else {
                stderr.to_string()
            }),
        };
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    let width = parts.first().and_then(|s| s.parse::<u32>().ok());
    let height = parts.get(1).and_then(|s| s.parse::<u32>().ok());

    match (width, height) {
        (Some(w), Some(h)) => ProbeImageResult {
            ok: true,
            width: Some(w),
            height: Some(h),
            error: None,
        },
        _ => ProbeImageResult {
            ok: false,
            width: None,
            height: None,
            error: Some("Could not parse dimensions.".into()),
        },
    }
}

/// Thumbnail via ffmpeg (replaces nativeImage.createFromPath().resize().toDataURL()).
/// `ffmpeg -i <input> -vf scale=<w>:-1 -f image2pipe -vframes 1 -vcodec png pipe:1`
pub async fn thumbnail(path: &str, width: u32) -> ThumbnailResult {
    let mut cmd = Command::new(resolve_ffmpeg(&None));
    cmd.args([
        "-i",
        path,
        "-vf",
        &format!("scale={width}:-1"),
        "-f",
        "image2pipe",
        "-vframes",
        "1",
        "-vcodec",
        "png",
        "pipe:1",
    ]);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => {
            return ThumbnailResult {
                ok: false,
                data_url: None,
                error: Some(e.to_string()),
            }
        }
    };

    if !out.status.success() || out.stdout.is_empty() {
        return ThumbnailResult {
            ok: false,
            data_url: None,
            error: Some("Could not read image.".into()),
        };
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&out.stdout);
    ThumbnailResult {
        ok: true,
        data_url: Some(format!("data:image/png;base64,{b64}")),
        error: None,
    }
}

// ---- helpers ----

/// Resolve the ffmpeg executable, in priority order:
///   1. explicit user path (if non-empty)
///   2. FFMPEG_PATH env var
///   3. bare "ffmpeg" (system PATH)
/// No bundled sidecar — the app relies on a system ffmpeg. Users without
/// one must install it (see README); the Advanced panel lets them set a path.
pub fn resolve_ffmpeg(explicit: &Option<String>) -> String {
    if let Some(p) = explicit.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return p.to_owned();
    }
    if let Ok(env) = std::env::var("FFMPEG_PATH") {
        if !env.trim().is_empty() {
            return env.trim().to_owned();
        }
    }
    "ffmpeg".into()
}

/// ExitStatus::signal() is unix-only; guard so this compiles on Windows.
/// Returns the numeric signal (as a string) on unix, None on Windows.
#[cfg(unix)]
fn signal_str(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|n| n.to_string())
}
#[cfg(not(unix))]
fn signal_str(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn no_window(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(target_os = "windows"))]
fn no_window(_cmd: &mut Command) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes tests that read or mutate FFMPEG_PATH/FFPROBE_PATH: cargo
    /// runs tests in parallel threads, and a reader must never observe a
    /// half-mutated env.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn parses_dimensions_csv() {
        let parts: Vec<&str> = "1920,1080".trim().split(',').collect();
        let w = parts.first().and_then(|s| s.parse::<u32>().ok());
        let h = parts.get(1).and_then(|s| s.parse::<u32>().ok());
        assert_eq!((w, h), (Some(1920), Some(1080)));
    }

    #[test]
    fn resolve_ffmpeg_returns_explicit_path() {
        assert_eq!(resolve_ffmpeg(&Some("/custom/ffmpeg".into())), "/custom/ffmpeg");
    }

    #[test]
    fn resolve_ffmpeg_trims_explicit_path() {
        assert_eq!(resolve_ffmpeg(&Some("  /custom/ffmpeg  ".into())), "/custom/ffmpeg");
    }

    // Env-var resolution is order-sensitive, so all cases live in one test:
    // cargo runs tests in parallel threads and env mutation across threads
    // would race.
    #[test]
    fn resolve_ffmpeg_env_priority() {
        let _guard = env_guard();
        std::env::remove_var("FFMPEG_PATH");
        assert_eq!(resolve_ffmpeg(&None), "ffmpeg");

        std::env::set_var("FFMPEG_PATH", "/env/ffmpeg");
        assert_eq!(resolve_ffmpeg(&None), "/env/ffmpeg");

        std::env::set_var("FFMPEG_PATH", "   ");
        assert_eq!(resolve_ffmpeg(&None), "ffmpeg");

        assert_eq!(resolve_ffmpeg(&Some("/custom/ffmpeg".into())), "/custom/ffmpeg");
        assert_eq!(resolve_ffmpeg(&Some("  /custom/ffmpeg  ".into())), "/custom/ffmpeg");

        std::env::remove_var("FFMPEG_PATH");
        assert_eq!(resolve_ffmpeg(&None), "ffmpeg");
    }

    #[test]
    fn parses_encoder_lines_from_real_output() {
        let stdout = "\
Encoders:
 V....D 012v                Uncompressed 4:2:2 10-bit
 VF...D exr                  OpenEXR image
 VF.... libopenjpeg          OpenJPEG JPEG 2000 (codec jpeg2000)
 V....D libwebp              libwebp WebP image (codec webp)
 V..... mjpeg_qsv            MJPEG (Intel Quick Sync Video acceleration) (codec mjpeg)
 VFS..D mjpeg                MJPEG (Motion JPEG)
 S....D srt                  SubRip subtitle (codec subrip)
 A....D aac                  AAC (Advanced Audio Coding)
";
        assert_eq!(
            parse_encoders(stdout),
            vec![
                "012v", "exr", "libopenjpeg", "libwebp", "mjpeg_qsv", "mjpeg", "srt", "aac"
            ]
        );
    }

    #[test]
    fn parses_encoders_ignores_noise() {
        assert!(parse_encoders("").is_empty());
        assert!(parse_encoders("Encoders:\n-------\n").is_empty());
        assert!(parse_encoders("ffmpeg version 8.0.1").is_empty());
    }

    #[test]
    fn resolve_ffprobe_derives_sibling_from_ffmpeg_path() {
        let _guard = env_guard();
        // A non-ffmpeg name must NOT become ffprobe; it falls through to
        // the env var (kept unset here — the env cases live in
        // resolve_ffprobe_env_priority, which holds the same lock).
        std::env::remove_var("FFPROBE_PATH");
        assert_eq!(
            resolve_ffprobe(&Some("/opt/ffmpeg/bin/ffmpeg".into())),
            "/opt/ffmpeg/bin/ffprobe"
        );
        assert_eq!(
            resolve_ffprobe(&Some("/opt/ffmpeg/bin/ffmpeg.exe".into())),
            "/opt/ffmpeg/bin/ffprobe.exe"
        );
        assert_eq!(
            resolve_ffprobe(&Some("C:\\ff\\ffmpeg.exe".into())),
            "C:\\ff\\ffprobe.exe"
        );
        // version-suffixed builds still map correctly
        assert_eq!(
            resolve_ffprobe(&Some("/opt/ff/ffmpeg-7".into())),
            "/opt/ff/ffprobe"
        );
        assert_eq!(resolve_ffprobe(&Some("/opt/tools/convert".into())), "ffprobe");
    }

    // Env-var resolution is order-sensitive: all cases in one test (cargo
    // runs tests in parallel threads).
    #[test]
    fn resolve_ffprobe_env_priority() {
        let _guard = env_guard();
        std::env::remove_var("FFPROBE_PATH");
        assert_eq!(resolve_ffprobe(&None), "ffprobe");
        assert_eq!(resolve_ffprobe(&Some(String::new())), "ffprobe");
        assert_eq!(resolve_ffprobe(&Some("  ".into())), "ffprobe");

        std::env::set_var("FFPROBE_PATH", "/env/ffprobe");
        assert_eq!(resolve_ffprobe(&None), "/env/ffprobe");
        // explicit ffmpeg path wins over env (sibling beats env)
        assert_eq!(
            resolve_ffprobe(&Some("/opt/ffmpeg/bin/ffmpeg".into())),
            "/opt/ffmpeg/bin/ffprobe"
        );

        std::env::remove_var("FFPROBE_PATH");
    }

    #[test]
    fn parses_probe_json_video_and_audio() {
        let json = r#"{
            "streams": [
                {"index":0,"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"pix_fmt":"yuv420p","r_frame_rate":"30/1"},
                {"index":1,"codec_type":"audio","codec_name":"aac","sample_rate":"44100","channels":2,"r_frame_rate":"0/0"}
            ],
            "format": {"duration": "12.345000"}
        }"#;
        let r = parse_probe_json(json).unwrap();
        assert!(r.ok);
        assert_eq!(r.duration, Some(12.345));
        let v = r.video.unwrap();
        assert_eq!(v.codec_name, "h264");
        assert_eq!((v.width, v.height), (Some(1920), Some(1080)));
        assert_eq!(v.frame_rate, Some(30.0));
        let a = r.audio.unwrap();
        assert_eq!(a.codec_name, "aac");
        assert_eq!(a.channels, Some(2));
        // audio streams expose r_frame_rate 0/0 — must parse to None, not NaN
        assert_eq!(a.frame_rate, None);
    }

    #[test]
    fn parses_probe_json_skips_cover_art_and_missing_duration() {
        // mp3 with attached album art: the png stream is cover art, not video
        let json = r#"{
            "streams": [
                {"index":0,"codec_type":"audio","codec_name":"mp3","sample_rate":"44100","channels":1},
                {"index":1,"codec_type":"video","codec_name":"png","width":64,"height":48,"pix_fmt":"rgb24","r_frame_rate":"90000/1","disposition":{"attached_pic":1}}
            ],
            "format": {"duration": "1.000000"}
        }"#;
        let r = parse_probe_json(json).unwrap();
        assert!(r.video.is_none(), "cover art must not classify as video");
        assert!(r.audio.is_some());

        // no-audio video: audio is None — planner must use -map 0:a:0?
        let json = r#"{"streams":[{"index":0,"codec_type":"video","codec_name":"h264","width":320,"height":240}],"format":{"duration":"2.000000"}}"#;
        let r = parse_probe_json(json).unwrap();
        assert!(r.video.is_some());
        assert!(r.audio.is_none());

        // still images carry no format duration
        let json = r#"{"streams":[{"index":0,"codec_type":"video","codec_name":"png","width":64,"height":48}],"format":{}}"#;
        let r = parse_probe_json(json).unwrap();
        assert_eq!(r.duration, None);
    }

    #[test]
    fn parses_probe_json_rejects_garbage() {
        assert!(parse_probe_json("").is_none());
        assert!(parse_probe_json("not json").is_none());
    }

    // ---- child-process integration test (real ffprobe) ----

    /// End-to-end: generate a 1s clip with lavfi, probe it, assert the
    /// summary. Skips itself when no ffmpeg/ffprobe is installed (CI matrix
    /// runners without ffmpeg must stay green).
    #[tokio::test]
    async fn probe_media_on_generated_clip() {
        let _guard = env_guard();
        if probe("ffmpeg").await.version.is_none() && !std::path::Path::new("/usr/bin/ffmpeg").exists() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("zonevert-probe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("clip.mp4");
        let clip_str = clip.to_string_lossy().to_string();
        let gen = Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=red:s=160x120:r=10",
                "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                &clip_str,
            ])
            .output()
            .await;
        if gen.is_err() || !std::path::Path::new(&clip).exists() {
            return; // ffmpeg present but no lavfi/libx264 — skip
        }

        let r = probe_media(&clip_str, &None).await;
        assert!(r.ok, "probe failed: {:?}", r.error);
        assert_eq!(r.duration, Some(1.0));        let v = r.video.expect("generated clip must report a video stream");
        assert_eq!(v.codec_name, "h264");
        assert_eq!((v.width, v.height), (Some(160), Some(120)));
        assert!(r.audio.is_none());
        let _ = std::fs::remove_file(&clip);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn atomic_temp_path_keeps_the_extension() {
        // ffmpeg infers the muxer from the extension — the temp name must
        // carry the real one or the run dies with "unable to choose an
        // output format".
        assert_eq!(
            atomic_temp_path("/dir/clip.mp4"),
            Some("/dir/clip.zonevert-tmp.mp4".into())
        );
        assert_eq!(
            atomic_temp_path("/dir/my.clip.webm"),
            Some("/dir/my.clip.zonevert-tmp.webm".into())
        );
        assert_eq!(
            atomic_temp_path("out.gif"),
            Some("out.zonevert-tmp.gif".into())
        );
        // Windows-style paths keep their backslashes (no /-normalization)
        assert_eq!(
            atomic_temp_path("C:\\dir\\clip.mp4"),
            Some("C:\\dir\\clip.zonevert-tmp.mp4".into())
        );
    }

    #[test]
    fn atomic_temp_path_skips_non_output_args() {
        // encoder validation ends in `-f null -`: the trailing `-` must not
        // become `-.zonevert-tmp` (ffmpeg parses it as an option).
        assert_eq!(atomic_temp_path("-"), None);
        assert_eq!(atomic_temp_path("-movflags"), None);
        assert_eq!(atomic_temp_path("pipe:1"), None);
        assert_eq!(atomic_temp_path("/dir/noext"), None);
        assert_eq!(atomic_temp_path(""), None);
    }

    /// The atomic layer against a real ffmpeg: the temp file keeps its
    /// extension so muxer inference succeeds, and success promotes it to the
    /// final path. Regression test for the `out.mp4.zonevert-tmp`
    /// "unable to choose an output format" bug.
    ///
    /// unix-only like its fake-script siblings: it uses tauri's mock_app, and
    /// the test feature is target-gated to unix (see Cargo.toml).
    #[tokio::test]
    #[cfg(unix)]
    async fn atomic_output_promotes_real_ffmpeg_output() {
        let _guard = env_guard();
        if probe("ffmpeg").await.version.is_none() && !std::path::Path::new("/usr/bin/ffmpeg").exists() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("zonevert-atomic-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("clip.mp4");
        let out = dir.join("out.mp4");
        let clip_str = clip.to_string_lossy().to_string();
        let out_str = out.to_string_lossy().to_string();
        let gen = Command::new("ffmpeg")
            .args([
                "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=red:s=160x120:r=10",
                "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                &clip_str,
            ])
            .output()
            .await;
        if gen.is_err() || !std::path::Path::new(&clip).exists() {
            return; // ffmpeg present but no lavfi/libx264 — skip
        }

        let req = ConvertRequest {
            job_id: "atomic-real".into(),
            ffmpeg_path: Some("ffmpeg".into()),
            args: vec![
                "-hide_banner".into(),
                "-loglevel".into(),
                "error".into(),
                "-y".into(),
                "-i".into(),
                clip_str,
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-c:v".into(),
                "libx264".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                out_str.clone(),
            ],
        };
        let registry = ProcessRegistry::default();
        let r = run(&tauri::test::mock_app().handle().clone(), &registry, req).await;
        assert!(r.ok, "real-ffmpeg atomic run failed: {:?}", r.error);
        assert!(out.exists(), "final output must exist after rename");
        assert!(
            !std::path::Path::new(atomic_temp_path(&out_str).unwrap().as_str()).exists(),
            "temp must be promoted, not left behind"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- child-process integration tests (fake ffmpeg scripts) ----

    /// Write an executable fake-ffmpeg script to a temp dir and return its path.
    ///
    /// Published via rename of a staging file: exec() of a file with an open
    /// writer fails with ETXTBSY ("Text file busy") — observed as flaky
    /// spawn failures on loaded machines — and rename guarantees the target
    /// inode was closed before it is ever executed.
    #[cfg(unix)]
    fn write_script(name: &str, body: &str) -> String {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicU32, Ordering};
        static SEQ: AtomicU32 = AtomicU32::new(0);

        let dir = std::env::temp_dir().join(format!("zonevert-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let staging = dir.join(format!("{name}.{}.staging", SEQ.fetch_add(1, Ordering::Relaxed)));
        {
            let mut f = std::fs::File::create(&staging).unwrap();
            writeln!(f, "#!/bin/sh\n{body}").unwrap();
        }
        std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::rename(&staging, &path).unwrap();
        // ponytail: 5ms settle — this environment's fs intermittently returns
        // ETXTBSY when exec'ing a just-published file (measured ~3% of spawns;
        // direct-write is ~9%, rename+settle 0/320). Remove the sleep if the
        // fs behavior is ever fixed; it costs 5ms per fake script.
        std::thread::sleep(std::time::Duration::from_millis(5));
        path.to_string_lossy().to_string()
    }

    #[cfg(unix)]
    fn convert_req(job_id: &str, ffmpeg_path: String) -> ConvertRequest {
        ConvertRequest {
            job_id: job_id.to_string(),
            ffmpeg_path: Some(ffmpeg_path),
            args: vec![],
        }
    }

    #[cfg(unix)]
    fn convert_req_with_output(job_id: &str, ffmpeg_path: String, output: String) -> ConvertRequest {
        ConvertRequest {
            job_id: job_id.to_string(),
            ffmpeg_path: Some(ffmpeg_path),
            args: vec!["-i".into(), "input".into(), output],
        }
    }

    #[cfg(unix)]
    fn unique_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("zonevert-{}-{}", tag, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Success path: fake ffmpeg "creates" the output, run() renames the temp
    /// into place and leaves no temp behind.
    #[tokio::test]
    #[cfg(unix)]
    async fn atomic_output_renames_on_success() {
        let app = tauri::test::mock_app();
        let dir = unique_dir("atomic-ok");
        let out = dir.join("out.mp4");
        let out_str = out.to_string_lossy().to_string();
        let script = write_script(
            "touch-last.sh",
            "for f in \"$@\"; do last=\"$f\"; done; touch \"$last\"; exit 0",
        );
        let r = run(
            app.handle(),
            &ProcessRegistry::default(),
            convert_req_with_output("atomic-ok", script, out_str.clone()),
        )
        .await;
        assert!(r.ok, "{:?}", r.error);
        assert!(out.exists(), "renamed output must exist");
        assert!(
            !std::path::Path::new(atomic_temp_path(&out_str).unwrap().as_str()).exists(),
            "temp must be gone after rename"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Failure path: no output file, and no partial temp left behind.
    #[tokio::test]
    #[cfg(unix)]
    async fn atomic_output_removes_temp_on_failure() {
        let app = tauri::test::mock_app();
        let dir = unique_dir("atomic-fail");
        let out = dir.join("out.mp4");
        let out_str = out.to_string_lossy().to_string();
        let script = write_script("fail.sh", "exit 1");
        let r = run(
            app.handle(),
            &ProcessRegistry::default(),
            convert_req_with_output("atomic-fail", script, out_str.clone()),
        )
        .await;
        assert!(!r.ok);
        assert!(!out.exists());
        assert!(
            !std::path::Path::new(atomic_temp_path(&out_str).unwrap().as_str()).exists(),
            "failed run must not leave a temp file"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Cancel path: a SIGKILLed run must not leave its partial temp file —
    /// the user never sees a half-written MP4 in their output dir.
    #[tokio::test]
    #[cfg(unix)]
    async fn atomic_output_removes_partial_file_on_sigkill() {
        let app = tauri::test::mock_app();
        let dir = unique_dir("atomic-kill");
        let out = dir.join("out.mp4");
        let out_str = out.to_string_lossy().to_string();
        let script = write_script(
            "partial.sh",
            "for f in \"$@\"; do last=\"$f\"; done; touch \"$last\"; trap '' TERM; sleep 60 >/dev/null 2>&1",
        );
        let registry = ProcessRegistry::default();
        let registry_in_task = registry.clone();
        let out_str_task = out_str.clone();
        let handle_task = tokio::spawn(async move {
            run(
                app.handle(),
                &registry_in_task,
                convert_req_with_output("atomic-kill", script, out_str_task),
            )
            .await
        });

        let notify = wait_for_entry(&registry, "atomic-kill").await;
        notify.notify_one();

        let r = tokio::time::timeout(std::time::Duration::from_secs(20), handle_task)
            .await
            .expect("run must return after SIGKILL escalation")
            .unwrap();
        assert!(!r.ok);
        assert!(
            !std::path::Path::new(atomic_temp_path(&out_str).unwrap().as_str()).exists(),
            "SIGKILLed partial temp must be cleaned up"
        );
        assert!(!out.exists(), "no final output from a killed run");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// >64KB of stderr, then exit 0. Without concurrent draining the OS pipe
    /// fills and the child blocks forever — wait() would never return.
    #[tokio::test]
    #[cfg(unix)]
    async fn run_drains_stderr_flood_without_deadlock() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let script = write_script(
            "flood.sh",
            "head -c 70000 /dev/zero | tr '\\0' 'e' 1>&2; exit 0",
        );
        let registry = ProcessRegistry::default();
        let r = run(&handle, &registry, convert_req("flood", script)).await;
        assert!(r.ok, "stderr flood must not deadlock the runner: {:?}", r.error);
        assert!(
            registry.0.lock().await.is_empty(),
            "registry must be cleaned up after exit"
        );
    }

    /// Cancel a process that exits on SIGTERM: run() returns promptly, !ok.
    #[tokio::test]
    #[cfg(unix)]
    async fn cancel_terminates_polite_process() {
        let app = tauri::test::mock_app();
        let script = write_script("polite.sh", "trap 'exit 3' TERM; sleep 60 >/dev/null 2>&1");
        let registry = ProcessRegistry::default();
        let registry_in_task = registry.clone();
        let handle_task = tokio::spawn(async move {
            run(app.handle(), &registry_in_task, convert_req("polite", script)).await
        });

        // Wait for the registry entry to appear, then cancel like the command does.
        let notify = wait_for_entry(&registry, "polite").await;
        notify.notify_one();

        let r = tokio::time::timeout(std::time::Duration::from_secs(20), handle_task)
            .await
            .expect("run must return after cancel")
            .unwrap();
        assert!(!r.ok, "cancelled job must not report success");
        assert!(registry.0.lock().await.is_empty());
    }

    /// Cancel a process that IGNORES SIGTERM: bounded escalation to SIGKILL
    /// (5s) must still terminate run(). Without escalation this hangs forever.
    #[tokio::test]
    #[cfg(unix)]
    async fn cancel_escalates_to_sigkill_when_sigterm_ignored() {
        let app = tauri::test::mock_app();
        let script = write_script("stubborn.sh", "trap '' TERM; sleep 60 >/dev/null 2>&1");
        let registry = ProcessRegistry::default();
        let registry_in_task = registry.clone();
        let handle_task = tokio::spawn(async move {
            run(app.handle(), &registry_in_task, convert_req("stubborn", script)).await
        });

        let notify = wait_for_entry(&registry, "stubborn").await;
        notify.notify_one();

        let r = tokio::time::timeout(std::time::Duration::from_secs(20), handle_task)
            .await
            .expect("run must return after SIGKILL escalation")
            .unwrap();
        assert!(!r.ok);
        assert!(registry.0.lock().await.is_empty());
    }

    /// Block until run() registers job_id, returning its cancel Notify.
    #[cfg(unix)]
    async fn wait_for_entry(registry: &ProcessRegistry, job_id: &str) -> Arc<Notify> {
        // ponytail: 20s budget (was 5s) — on slow/loaded CI boxes the
        // spawned run() task can be starved past 5s; these tests assert the
        // cancel mechanism, not spawn latency.
        for _ in 0..400 {
            {
                let map = registry.0.lock().await;
                if let Some((_, cancel)) = map.get(job_id) {
                    return cancel.clone();
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        panic!("run() never registered job {job_id}");
    }
}
