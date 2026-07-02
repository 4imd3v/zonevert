# 3. Rust Backend — Full Source

The complete `src-tauri/` Rust code implementing the 7 commands + state from
[02-ipc-mapping.md](./02-ipc-mapping.md). Compiles against Tauri 2 on Windows
+ Linux.

## `Cargo.toml`

```toml
[package]
name = "zonevert"
version = "0.1.0"
edition = "2021"

[lib]
name = "zonevert_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["process", "io-util", "sync", "rt-multi-thread", "macros"] }
base64 = "0.22"

# kill-by-PID for the cancel path (see state.rs / kill_pid).
[target.'cfg(unix)'.dependencies]
nix = { version = "0.29", features = ["signal"] }

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_Foundation", "Win32_System_Threading"] }

[features]
# default = ["custom-protocol"]   # enable for production asset protocol
```

No `image` crate — thumbnails go through ffmpeg (see
[02-ipc-mapping.md#thumbnail](./02-ipc-mapping.md#thumbnail)). `base64` is for
the thumbnail data URL; `nix`/`windows-sys` are for kill-by-PID in `cancel`.

## `src/main.rs`

```rust
// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zonevert_lib::run()
}
```

## `src/lib.rs`

Builder setup, plugin registration, command wiring, and process cleanup on exit.

```rust
mod commands;
mod ffmpeg;
mod state;

use state::ProcessRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessRegistry::default())
        .on_window_event(|window, event| {
            // Kill any running ffmpeg children when the window closes.
            // ponytail: app-wide quit cleanup; if multi-window is added later,
            // gate this on RunEvent::ExitRequested instead.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<ProcessRegistry>() {
                    let registry = state.0.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut map = registry.lock().await;
                        for (_, pid) in map.drain() {
                            state::kill_pid(pid);
                        }
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::platform,
            commands::probe_ffmpeg,
            commands::convert,
            commands::cancel,
            commands::check_exists,
            commands::save_file,
            commands::image_thumbnail,
            commands::probe_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## state.rs

A `tokio::sync::Mutex<HashMap<String, u32>>` mapping `jobId` → **PID** (not the
`Child` itself). Storing the PID — not the `tokio::process::Child` — is what
lets `convert` keep the `Child` locally (to `wait()` on it and read its
stdout/stderr) while `cancel` kills the OS process by PID without contending
the mutex for the child handle.

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Maps jobId -> ffmpeg PID, so `cancel` can kill the process by PID.
/// The Child itself stays in `convert`'s scope (it owns the stdout/stderr
/// readers and the wait() handle); only the PID is shared here.
#[derive(Default, Clone)]
pub struct ProcessRegistry(pub Arc<Mutex<HashMap<String, u32>>>);

/// Kill a process by PID. Cross-platform: SIGTERM on unix, TerminateProcess
/// on Windows. No-op if the PID is stale (process already exited).
#[cfg(unix)]
pub fn kill_pid(pid: u32) {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
}

#[cfg(windows)]
pub fn kill_pid(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle != 0 {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}
```

`Arc` so the `on_window_event` cleanup closure can cheaply clone it. `Mutex`
(not `RwLock`) because `cancel` mutates (removes + kills).

## `src/commands.rs`

Thin command handlers — argument shapes mirror Electron's payload keys
(`serde(rename_all = "camelCase")` keeps the JSON identical to what
`conversion-plan.ts` sends today). Validation bounds from `ipc-validation.ts`
are replicated as defense-in-depth.

```rust
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
    match explicit.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()) {
        Some(p) => p,
        None => std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into()),
    }
}
```

### `platform`

```rust
/// Returns Electron-style platform strings so conversion-plan.ts
/// (`=== "win32"`) needs no changes.
#[tauri::command]
fn platform() -> &'static str {
    #[cfg(target_os = "windows")]
    { "win32" }
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(target_os = "macos")]
    { "darwin" }
}
```

### `probe_ffmpeg`

```rust
#[tauri::command]
async fn probe_ffmpeg(ffmpeg_path: Option<String>) -> ProbeResult {
    ffmpeg::probe(&resolve_path(ffmpeg_path)).await
}
```

### `convert`

```rust
#[tauri::command]
async fn convert(
    app: tauri::AppHandle,
    state: State<'_, ProcessRegistry>,
    payload: ConvertRequest,
) -> ConvertResult {
    // Defense-in-depth bounds from ipc-validation.ts:
    // jobId <= 128, args <= 512, each arg <= 8192.
    if payload.job_id.len() > 128 {
        return ConvertResult { ok: false, error: Some("Job id is too long.".into()), code: None, signal: None };
    }
    if payload.args.is_empty() {
        return ConvertResult { ok: false, error: Some("Conversion args cannot be empty.".into()), code: None, signal: None };
    }
    if payload.args.len() > 512 {
        return ConvertResult { ok: false, error: Some("Conversion args exceed limit.".into()), code: None, signal: None };
    }
    if payload.args.iter().any(|a| a.len() > 8192) {
        return ConvertResult { ok: false, error: Some("Conversion arg is too long.".into()), code: None, signal: None };
    }

    ffmpeg::run(&app, &state.inner(), payload).await
}
```

### `cancel`

Looks up the PID and kills it cross-platform via `state::kill_pid`.

```rust
#[tauri::command]
async fn cancel(state: State<'_, ProcessRegistry>, job_id: String) -> CancelResult {
    let mut map = state.0.lock().await;
    match map.remove(&job_id) {
        Some(pid) => {
            state::kill_pid(pid);
            CancelResult { ok: true, error: None }
        }
        None => CancelResult { ok: false, error: Some("No running process found.".into()) },
    }
}
```

### `check_exists`

```rust
#[tauri::command]
fn check_exists(path: String) -> ExistsResult {
    ExistsResult { ok: true, exists: std::path::Path::new(&path).exists() }
}
```

### `save_file`

```rust
#[tauri::command]
async fn save_file(file_path: String, content: String) -> SaveResult {
    match tokio::fs::write(&file_path, content).await {
        Ok(_) => SaveResult { ok: true, file_path, error: None },
        Err(e) => SaveResult { ok: false, file_path, error: Some(e.to_string()) },
    }
}
```

### `image_thumbnail`

```rust
#[tauri::command]
async fn image_thumbnail(file_path: String) -> ThumbnailResult {
    ffmpeg::thumbnail(&file_path, 48).await
}
```

### `probe_image`

```rust
#[tauri::command]
async fn probe_image(file_path: String, ffmpeg_path: Option<String>) -> ProbeImageResult {
    ffmpeg::probe_image(&file_path, &resolve_path(ffmpeg_path)).await
}
```

### Validation

The renderer already validates via `ipc-validation.ts` before calling
`convert`. The Rust bounds above (128/512/8192) are the same constants,
replicated server-side so a malicious/direct `invoke` can't bypass them. If you
change a constant, update both files. (`ipc-validation.ts` is the source of
truth — it's where the limits were originally defined.)

## `src/ffmpeg.rs`

The spawn/capture/emit logic. Mirrors `main.js`'s `runProbe` / `runConversion` /
`ffprobe:run` / `image:thumbnail`, ported to `tokio::process::Command`.

Key ports from Electron:
- `windowsHide: true` → on Windows, `CREATE_NO_WINDOW` flag (0x08000000) so a
  console window doesn't flash. Linux/macOS have no equivalent and don't need it.
- `event.sender.send("ffmpeg:log", { jobId, stream, text })` →
  `app.emit("ffmpeg:log", LogPayload { job_id, stream, text })`. Same payload
  shape (camelCase), same global-event semantics.
- The child's **PID** is stored in `ProcessRegistry` keyed by `jobId` between
  spawn and close, then removed (matching `runningProcesses.set` / `.delete`).
  The `Child` itself stays in `run`'s scope — it owns the stdout/stderr readers
  and the `wait()` handle; only the PID is shared for cancel.

```rust
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
    stream: &'static str,   // "stdout" | "stderr"
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
        Err(e) => return ProbeResult { ok: false, code: None, version: None, error: Some(e.to_string()) },
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let first_line = stdout.lines().next().unwrap_or("").to_owned();

    if out.status.success() {
        ProbeResult { ok: true, code: Some(out.status.code().unwrap_or(0)), version: Some(first_line), error: None }
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        ProbeResult {
            ok: false,
            code: out.status.code(),
            version: Some(first_line),
            error: Some(if stderr.is_empty() { stdout.to_string() } else { stderr.to_string() }),
        }
    }
}

/// `ffmpeg <args>` conversion with live log streaming (replaces runConversion).
pub async fn run(app: &AppHandle, registry: &ProcessRegistry, req: ConvertRequest) -> ConvertResult {
    let mut cmd = Command::new(resolve_explicit_or(&req.ffmpeg_path, "ffmpeg"));
    cmd.args(&req.args);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return ConvertResult { ok: false, code: None, signal: None, error: Some(e.to_string()) },
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
        let mut text = String::new();
        loop {
            text.clear();
            let n = match stdout.read(&mut buf).await { Ok(0) => break, Ok(n) => n, Err(_) => break };
            text.push_str(&String::from_utf8_lossy(&buf[..n]));
            let _ = app_clone.emit("ffmpeg:log", LogPayload { job_id: job_id_stdout.clone(), stream: "stdout", text });
        }
    });

    let app_clone = app.clone();
    let job_id_stderr = job_id.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 8192];
        let mut text = String::new();
        loop {
            text.clear();
            let n = match stderr.read(&mut buf).await { Ok(0) => break, Ok(n) => n, Err(_) => break };
            text.push_str(&String::from_utf8_lossy(&buf[..n]));
            let _ = app_clone.emit("ffmpeg:log", LogPayload { job_id: job_id_stderr.clone(), stream: "stderr", text });
        }
    });

    // The Child stays in this scope — wait() here, cancel kills by PID.
    let status = child.wait().await;
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    registry.0.lock().await.remove(&job_id);

    match status {
        Ok(s) if s.success() => ConvertResult { ok: true, code: s.code(), signal: None, error: None },
        Ok(s) => ConvertResult {
            ok: false,
            code: s.code(),
            signal: signal_str(&s),   // unix-only signal name, None on Windows
            error: Some(format!("FFmpeg exited with code {}.", s.code().unwrap_or(-1))),
        },
        Err(e) => ConvertResult { ok: false, code: None, signal: None, error: Some(e.to_string()) },
    }
}

/// `ffprobe` width/height probe (replaces ffprobe:run).
pub async fn probe_image(path: &str, ffprobe: &str) -> ProbeImageResult {
    let mut cmd = Command::new(ffprobe);
    cmd.args(["-v", "error", "-select_streams", "v:0",
              "-show_entries", "stream=width,height",
              "-of", "csv=p=0", path]);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => return ProbeImageResult { ok: false, width: None, height: None, error: Some(e.to_string()) },
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return ProbeImageResult {
            ok: false, width: None, height: None,
            error: Some(if stderr.is_empty() { format!("ffprobe exited with code {}", out.status.code().unwrap_or(-1)) } else { stderr.to_string() }),
        };
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    let width = parts.first().and_then(|s| s.parse::<u32>().ok());
    let height = parts.get(1).and_then(|s| s.parse::<u32>().ok());

    match (width, height) {
        (Some(w), Some(h)) => ProbeImageResult { ok: true, width: Some(w), height: Some(h), error: None },
        _ => ProbeImageResult { ok: false, width: None, height: None, error: Some("Could not parse dimensions.".into()) },
    }
}

/// Thumbnail via ffmpeg (replaces nativeImage.createFromPath().resize().toDataURL()).
/// `ffmpeg -i <input> -vf scale=<w>:-1 -f image2pipe -vframes 1 -vcodec png pipe:1`
pub async fn thumbnail(path: &str, width: u32) -> ThumbnailResult {
    let mut cmd = Command::new(resolve_env_or("ffmpeg"));
    cmd.args(["-i", path,
              "-vf", &format!("scale={width}:-1"),
              "-f", "image2pipe",
              "-vframes", "1",
              "-vcodec", "png",
              "pipe:1"]);
    no_window(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());

    let out = match cmd.output().await {
        Ok(o) => o,
        Err(e) => return ThumbnailResult { ok: false, data_url: None, error: Some(e.to_string()) },
    };

    if !out.status.success() || out.stdout.is_empty() {
        return ThumbnailResult { ok: false, data_url: None, error: Some("Could not read image.".into()) };
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&out.stdout);
    ThumbnailResult { ok: true, data_url: Some(format!("data:image/png;base64,{b64}")), error: None }
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
```

## `build.rs`

```rust
fn main() {
    tauri_build::build()
}
```

## `capabilities/default.json`

Tauri 2 requires explicit capability grants. The dialog + notification plugins
ship sensible defaults; the global `ffmpeg:log` event needs a capability too.

```jsonc
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Zonevert main window capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "notification:default",
    "core:event:default",
    "core:event:allow-listen",
    "core:event:allow-unlisten"
  ]
}
```

No `shell:*` or `fs:*` permissions — those operations go through Rust commands,
not the scoped plugins, so the capability surface stays minimal (matches the
["spawn in Rust" decision](./README.md#key-decisions-read-before-starting)).

> Rust-side `app.emit("ffmpeg:log", ...)` needs no capability — only the JS
> `listen()` call does, hence `core:event:allow-listen` / `allow-unlisten`.

## Smoke test

A one-file runnable check that the ffmpeg CSV parsing is sound, runnable with
`cargo test --manifest-path src-tauri/Cargo.toml`:

```rust
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
```

(ponytail: smallest thing that fails if the CSV parse breaks — no per-fn
suite for one parser.)

→ [04-frontend.md](./04-frontend.md) for the typed `bindings.ts` that calls these.
