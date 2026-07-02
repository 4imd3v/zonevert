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

// ---- helpers ----

/// Resolves the ffmpeg/ffprobe binary path: explicit > FFMPEG_PATH env > "ffmpeg".
/// Mirrors main.js resolveFfmpegPath exactly.
fn resolve_path(explicit: Option<String>) -> String {
    match explicit
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
    {
        Some(p) => p,
        None => std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into()),
    }
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
    ffmpeg::probe(&resolve_path(ffmpeg_path)).await
}

#[tauri::command]
pub async fn convert(
    app: tauri::AppHandle,
    state: State<'_, ProcessRegistry>,
    payload: ConvertRequest,
) -> Result<ConvertResult, String> {
    // Defense-in-depth bounds from ipc-validation.ts:
    // jobId <= 128, args <= 512, each arg <= 8192.
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
    ffmpeg::probe_image(&file_path, &resolve_path(ffmpeg_path)).await
}

// The validation bounds above (128/512/8192) replicate ipc-validation.ts
// server-side. If you change a constant, update both files.
// (ipc-validation.ts is the source of truth — it's where the limits were
// originally defined.)
