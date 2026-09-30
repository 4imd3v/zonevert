use crate::{commands::*, state::ProcessRegistry};
use base64::Engine;
use serde::Serialize;
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
    let mut cmd = Command::new(resolve_ffmpeg(&req.ffmpeg_path));
    cmd.args(&req.args);
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

    match status {
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
    }
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

    // ---- child-process integration tests (fake ffmpeg scripts) ----

    /// Write an executable fake-ffmpeg script to a temp dir and return its path.
    #[cfg(unix)]
    fn write_script(name: &str, body: &str) -> String {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("zonevert-{}-{}", name, std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(f, "#!/bin/sh\n{body}").unwrap();
        drop(f);
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().to_string()
    }

    fn convert_req(job_id: &str, ffmpeg_path: String) -> ConvertRequest {
        ConvertRequest {
            job_id: job_id.to_string(),
            ffmpeg_path: Some(ffmpeg_path),
            args: vec![],
        }
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
        assert!(r.ok, "stderr flood must not deadlock the runner");
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

        let r = tokio::time::timeout(std::time::Duration::from_secs(10), handle_task)
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
        for _ in 0..100 {
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
