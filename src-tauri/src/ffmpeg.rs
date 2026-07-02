use crate::{commands::*, state::ProcessRegistry};
use base64::Engine;
use serde::Serialize;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
pub async fn run(
    app: &AppHandle,
    registry: &ProcessRegistry,
    req: ConvertRequest,
) -> ConvertResult {
    let mut cmd = Command::new(resolve_explicit_or(&req.ffmpeg_path, "ffmpeg"));
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

    // Store the PID (not the Child) so cancel can kill by PID without
    // contending the child's stdout/stderr readers or wait() handle.
    let pid = child.id();
    let job_id = req.job_id.clone();
    if let Some(pid) = pid {
        registry.0.lock().await.insert(job_id.clone(), pid);
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
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 8192];
        loop {
            let n = match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            let text = String::from_utf8_lossy(&buf[..n]).to_string();
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

    // The Child stays in this scope — wait() here, cancel kills by PID.
    let status = child.wait().await;
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    registry.0.lock().await.remove(&job_id);

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
            signal: signal_str(&s), // unix-only signal name, None on Windows
            error: Some(format!(
                "FFmpeg exited with code {}.",
                s.code().unwrap_or(-1)
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

/// `ffprobe` width/height probe (replaces ffprobe:run).
pub async fn probe_image(path: &str, ffprobe: &str) -> ProbeImageResult {
    let mut cmd = Command::new(ffprobe);
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
    let mut cmd = Command::new(resolve_env_or("ffmpeg"));
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

fn resolve_explicit_or(explicit: &Option<String>, fallback: &str) -> String {
    match explicit.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => p.to_owned(),
        None => std::env::var("FFMPEG_PATH").unwrap_or_else(|_| fallback.into()),
    }
}

fn resolve_env_or(fallback: &str) -> String {
    std::env::var("FFMPEG_PATH").unwrap_or_else(|_| fallback.into())
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
    #[test]
    fn parses_dimensions_csv() {
        let parts: Vec<&str> = "1920,1080".trim().split(',').collect();
        let w = parts.first().and_then(|s| s.parse::<u32>().ok());
        let h = parts.get(1).and_then(|s| s.parse::<u32>().ok());
        assert_eq!((w, h), (Some(1920), Some(1080)));
    }
}
