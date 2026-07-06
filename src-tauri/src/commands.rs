use crate::{ffmpeg, state::ProcessRegistry};
use serde::{Deserialize, Serialize};
use tauri::State;

// ---- shared result shapes (camelCase to match the TS interfaces) ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistsResult {
    pub ok: bool,
    pub exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub ok: bool,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeImageResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ---- request shapes ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub job_id: String,
    pub ffmpeg_path: Option<String>,
    pub args: Vec<String>,
}

// ---- commands ----

/// Returns Electron-style platform strings so conversion-plan.ts
/// (`=== "win32"`) needs no changes.
#[tauri::command]
pub fn platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "win32"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(target_os = "macos")]
    {
        "darwin"
    }
}

#[tauri::command]
pub async fn probe_ffmpeg(ffmpeg_path: Option<String>) -> ProbeResult {
    ffmpeg::probe(&ffmpeg::resolve_explicit_or(&ffmpeg_path, "ffmpeg")).await
}

#[tauri::command]
pub async fn convert(
    app: tauri::AppHandle,
    state: State<'_, ProcessRegistry>,
    payload: ConvertRequest,
) -> Result<ConvertResult, String> {
    // Server-side bounds: jobId <= 128, args <= 512, each arg <= 8192.
    // This is the trust boundary (browser can be bypassed), not a mirror of client code.
    if payload.job_id.len() > 128 {
        return Ok(ConvertResult {
            ok: false,
            error: Some("Job id is too long.".into()),
            code: None,
            signal: None,
        });
    }
    if payload.args.is_empty() {
        return Ok(ConvertResult {
            ok: false,
            error: Some("Conversion args cannot be empty.".into()),
            code: None,
            signal: None,
        });
    }
    if payload.args.len() > 512 {
        return Ok(ConvertResult {
            ok: false,
            error: Some("Conversion args exceed limit.".into()),
            code: None,
            signal: None,
        });
    }
    if payload.args.iter().any(|a| a.len() > 8192) {
        return Ok(ConvertResult {
            ok: false,
            error: Some("Conversion arg is too long.".into()),
            code: None,
            signal: None,
        });
    }

    Ok(ffmpeg::run(&app, state.inner(), payload).await)
}

#[tauri::command]
pub async fn cancel(
    state: State<'_, ProcessRegistry>,
    job_id: String,
) -> Result<CancelResult, String> {
    let mut map = state.0.lock().await;
    match map.remove(&job_id) {
        Some(pid) => {
            crate::state::kill_pid(pid);
            Ok(CancelResult {
                ok: true,
                error: None,
            })
        }
        None => Ok(CancelResult {
            ok: false,
            error: Some("No running process found.".into()),
        }),
    }
}

#[tauri::command]
pub fn check_exists(path: String) -> ExistsResult {
    ExistsResult {
        ok: true,
        exists: std::path::Path::new(&path).exists(),
    }
}

#[tauri::command]
pub async fn save_file(file_path: String, content: String) -> SaveResult {
    match tokio::fs::write(&file_path, content).await {
        Ok(_) => SaveResult {
            ok: true,
            file_path,
            error: None,
        },
        Err(e) => SaveResult {
            ok: false,
            file_path,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn image_thumbnail(file_path: String) -> ThumbnailResult {
    ffmpeg::thumbnail(&file_path, 48).await
}

#[tauri::command]
pub async fn probe_image(file_path: String, ffmpeg_path: Option<String>) -> ProbeImageResult {
    ffmpeg::probe_image(&file_path, &ffmpeg::resolve_explicit_or(&ffmpeg_path, "ffmpeg")).await
}

#[cfg(test)]
mod tests {
    use super::*;

    // Phase 4: functional parity — each directly-callable command returns the
    // correct result shape. ffmpeg-dependent commands return {ok:false} when
    // ffmpeg is absent (the shape is what we assert, not the success).
    // convert/cancel need AppHandle+State (Tauri runtime) — verified via app boot.

    #[test]
    fn platform_returns_electron_string() {
        let p = platform();
        #[cfg(target_os = "linux")]
        assert_eq!(p, "linux");
        #[cfg(target_os = "windows")]
        assert_eq!(p, "win32");
        #[cfg(target_os = "macos")]
        assert_eq!(p, "darwin");
    }

    #[tokio::test]
    async fn check_exists_reports_true_and_false() {
        let exists = check_exists("/".into());
        assert!(exists.ok);
        assert!(exists.exists);
        let missing = check_exists("/nonexistent-zonevert-test-path-12345".into());
        assert!(missing.ok);
        assert!(!missing.exists);
    }

    #[tokio::test]
    async fn probe_ffmpeg_returns_shape_when_absent() {
        let r = probe_ffmpeg(None).await;
        // ffmpeg not on PATH in this env → ok:false with an error string.
        // On a machine with ffmpeg, this would be ok:true with a version.
        if !r.ok {
            assert!(r.error.is_some(), "error must be Some when ok is false");
        }
        // Either way the shape is valid (ok:bool, code:Option, version:Option, error:Option).
    }

    #[tokio::test]
    async fn probe_image_returns_error_shape_when_ffprobe_absent() {
        let r = probe_image("/usr/share/doc/libpng-dev/examples/pngtest.png".into(), None).await;
        if !r.ok {
            assert!(r.error.is_some());
        } else {
            assert!(r.width.is_some() && r.height.is_some());
        }
    }

    #[tokio::test]
    async fn image_thumbnail_returns_error_shape_when_ffmpeg_absent() {
        let r = image_thumbnail("/usr/share/doc/libpng-dev/examples/pngtest.png".into()).await;
        if !r.ok {
            assert!(r.error.is_some());
            assert!(r.data_url.is_none());
        }
    }

    #[tokio::test]
    async fn save_file_writes_then_reports() {
        let dir = std::env::temp_dir().join("zonevert-phase4-test.txt");
        let path = dir.to_string_lossy().to_string();
        let r = save_file(path.clone(), "hello".into()).await;
        assert!(r.ok);
        assert_eq!(r.file_path, path);
        let _ = std::fs::remove_file(&path);
    }
}
