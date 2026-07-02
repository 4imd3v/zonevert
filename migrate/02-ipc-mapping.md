# 2. IPC Mapping — Every Handler

The complete Electron → Tauri translation of the `window.zonevert` contract.
Each section shows the current Electron code (from `src/main.js` +
`src/preload.js`), the Tauri approach, and the decision rationale.

The renderer's 11 methods map to:
- **7 Rust commands** (`#[tauri::command]`) — ffmpeg/ffprobe/fs/thumbnail/save
- **3 plugin calls** (dialog ×2, notification) — handled in `bindings.ts`, no Rust
- **1 event stream** (`ffmpeg:log`) — Rust emits, `bindings.ts` subscribes
- **1 property** (`platform`) — trivial Rust command

The JS snippets below are the bodies of the functions in `bindings.ts`
([04-frontend.md](./04-frontend.md)) — they `import` from
`@tauri-apps/plugin-*` (npm, bundled by Vite), not `window.__TAURI__` globals.

---

## `platform` (property)

**Electron** (`preload.js`): `process.platform` → `"win32"` / `"linux"` / `"darwin"`.

**Tauri**: Tauri's os returns `"windows"` / `"linux"` / `"macos"`. But
`conversion-plan.ts` (`=== "win32"` check) hard-codes the Electron values.
Expose a one-line Rust command that returns Electron-style strings so the
path-quoting logic in `formatCommand` stays unchanged:

```rust
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

The `getPlatform()` binding `await`s it once during `appState.init()`
([07-svelte-frontend.md](./07-svelte-frontend.md)) and caches the result as a
`$state` field; components read the cached value synchronously.

---

## `selectImages()`

**Electron**: `dialog.showOpenDialog({ properties: ["openFile",
"multiSelections"], filters: [{ name: "Images", extensions: [...] }] })` →
`[{ path, name }]`.

**Tauri**: `@tauri-apps/plugin-dialog`'s `open()` does this directly from JS.
No Rust command needed — `bindings.ts` calls the plugin and maps the result.

```ts
// bindings.ts body
export async function selectImages(): Promise<SelectedImage[]> {
  const result = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Images", extensions: [
        "apng","avif","bmp","gif","heic","heif","jpeg","jpg","png","tif","tiff","webp"
      ]},
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (!result) return [];           // canceled → []
  const list = Array.isArray(result) ? result : [result];
  return list.map((p) => ({ path: p, name: basename(p) }));
}
```

`basename` is a tiny helper in `bindings.ts` (split on `/` and `\`) — no Node
`path` module available in the bundled frontend. The result shape
(`{ path, name }`) matches exactly.

---

## `selectOutputDir()`

**Electron**: `dialog.showOpenDialog({ properties: ["openDirectory",
"createDirectory"] })` → `""` on cancel.

**Tauri**:

```ts
export async function selectOutputDir(): Promise<string> {
  const result = await open({ directory: true, multiple: false });
  return result ?? "";              // null on cancel → ""
}
```

The dialog plugin doesn't expose `createDirectory` as a flag, but the native
directory picker allows creating folders on both platforms, so behavior matches.

---

## `probeFFmpeg(ffmpegPath)`

**Electron**: spawns `ffmpeg -version`, captures stdout first line, returns
`{ ok, code?, version?, error? }`.

**Tauri**: Rust command. Resolution logic mirrors `runProbe` exactly.

```rust
#[tauri::command]
async fn probe_ffmpeg(ffmpeg_path: Option<String>) -> ProbeResult {
    ffmpeg::probe(&resolve_path(ffmpeg_path)).await
}
```

See [`03-rust-backend.md#probe_ffmpeg`](./03-rust-backend.md#probe_ffmpeg) for
the full `ffmpeg::probe` implementation. Returns the same
`{ ok, code, version, error }` shape (serde `rename_all = "camelCase"` keeps
keys identical to the TS `ProbeResult` interface).

---

<a name="convert"></a>
## `convert(payload)` ← `ffmpeg:convert` 

**Electron** (`main.js:runConversion`): spawns `ffmpeg <args>`, pushes
`ffmpeg:log` events (`{ jobId, stream, text }`) per stdout/stderr chunk,
stores child in `runningProcesses` map, resolves `{ ok, code, signal, error }`
on close.

**Tauri**: Rust command. Two sub-decisions:

### a) Spawning: Rust `Command`, not the shell plugin

The `tauri-plugin-shell` `Command::create` requires a **pre-configured scope**
with arg validators (regex per position). Zonevert builds ffmpeg args
dynamically from user conversion intent (`conversion-plan.ts` → up to 512
arbitrary string args). The shell plugin's scoped validators cannot express
"any string" per arg position without permuting the validator matrix. So we
spawn directly in Rust via `tokio::process::Command` — full control, no scope
plumbing, and the args already go through `ipc-validation.ts` validation on
the frontend (replicated in Rust as defense-in-depth).

### b) Log streaming: Tauri events, not Channels

The store registers **one global** `onLog` callback that receives logs for
**all** jobs, keyed by `jobId`. Two Tauri options:

| Approach | Matches store? | When to use |
|---|---|---|
| **Global event** `app.emit("ffmpeg:log", { jobId, stream, text })` | ✅ exact | chosen — small text, few/sec |
| Per-call **Channel** | ❌ needs store rewrite | only if log volume becomes high |

Events are the faithful 1:1 port. ffmpeg stderr is a few lines/sec — well
within the event system's design (it's only unsuited for high-throughput /
large binary). `bindings.ts`'s `onLog` calls `listen("ffmpeg:log", ...)`.

```rust
#[tauri::command]
async fn convert(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcessRegistry>,
    payload: ConvertRequest,
) -> ConvertResult {
    // ...validation bounds (see 03-rust-backend.md#convert)...
    ffmpeg::run(&app, &state.inner(), payload).await
}
```

`ffmpeg::run` emits `ffmpeg:log` per chunk via `app.emit(...)`, stores the
child's **PID** in `ProcessRegistry` for cancel (not the `Child` itself — see
[`03-rust-backend.md#staters`](./03-rust-backend.md#staters)), returns the
result on close. Full source:
[`03-rust-backend.md#convert`](./03-rust-backend.md#convert).

---

## `cancel(jobId)` ← `ffmpeg:cancel`

**Electron**: looks up child in `runningProcesses`, calls `.kill()`.

**Tauri**: Rust command over the same `ProcessRegistry` state — kills by PID
(cross-platform SIGTERM / TerminateProcess):

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

The registry stores `jobId -> PID` (not the `Child`), so `convert` keeps the
`Child` locally for `wait()`/streaming while `cancel` kills the OS process.
Full source: [`03-rust-backend.md#cancel`](./03-rust-backend.md#cancel).
Clean up on app exit (see [`state.rs`](./03-rust-backend.md#staters)).

---

## `showNotification(payload)` ← `notification:show`

**Electron**: `new Notification({ title, body }).show()`, returns `{ ok }` or
`{ ok: false, error }` if unsupported.

**Tauri**: `@tauri-apps/plugin-notification`. Done in `bindings.ts`:

```ts
export async function showNotification(payload: { title: string; body?: string }) {
  let granted = await isPermissionGranted();
  if (!granted) {
    const p = await requestPermission();
    granted = p === "granted";
  }
  if (!granted) return { ok: false, error: "Notifications not supported on this platform." };
  sendNotification({ title: payload.title, body: payload.body ?? "" });
  return { ok: true };
}
```

**Difference**: Tauri requires an explicit permission request on first use
(Electron's `Notification.isSupported()` was a boolean). On Linux WebKitGTK
this is usually auto-granted; on Windows the first call may prompt.
`bindings.ts` handles it so components are unchanged.

---

## `saveFile(payload)` ← `dialog:save-file`

**Electron**: `dialog.showSaveDialog(...)` then `fs.writeFile(path, content)`.

**Tauri**: save dialog from the plugin (JS), then write via a Rust command
(avoids configuring the `fs` plugin's scope for arbitrary write paths):

```ts
// bindings.ts body
export async function saveFile(payload: {
  title?: string; defaultPath?: string; content: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<SaveResult> {
  const filePath = await save({
    title: payload.title ?? "Save file",
    defaultPath: payload.defaultPath ?? "output.txt",
    filters: payload.filters ?? [{ name: "Text", extensions: ["txt"] }]
  });
  if (!filePath) return { ok: false, filePath: "", canceled: true };
  return invoke<SaveResult>("save_file", { filePath, content: payload.content });
}
```

```rust
#[tauri::command]
async fn save_file(file_path: String, content: String) -> SaveResult {
    match tokio::fs::write(&file_path, content).await {
        Ok(_) => SaveResult { ok: true, file_path, error: None },
        Err(e) => SaveResult { ok: false, file_path, error: Some(e.to_string()) },
    }
}
```

---

## `checkExists(filePath)` ← `fs:check-exists`

**Electron**: `fsSync.existsSync(path)` → `{ ok: true, exists }`.

**Tauri**: trivial Rust command.

```rust
#[tauri::command]
fn check_exists(path: String) -> ExistsResult {
    ExistsResult { ok: true, exists: std::path::Path::new(&path).exists() }
}
```

No `async` needed — `exists()` is fast and non-blocking enough for a path stat.

---

<a name="thumbnail"></a>
## `getThumbnail(filePath)` ← `image:thumbnail` 

**Electron**: `nativeImage.createFromPath(path).resize({ width: 48 }).toDataURL()`.

**Tauri**: zonevert already requires ffmpeg, so reuse it to render a 48px-wide
PNG and base64 it. Supports every format ffmpeg reads (avif, heic, …) — wider
than the Rust `image` crate, with **zero new deps**:

```rust
#[tauri::command]
async fn image_thumbnail(file_path: String) -> ThumbnailResult {
    ffmpeg::thumbnail(&file_path, 48).await
}
```

`ffmpeg::thumbnail` runs (no `windowsHide` flag needed — ffmpeg has no GUI):

```bash
ffmpeg -i <input> -vf scale=48:-1 -f image2pipe -vframes 1 -vcodec png pipe:1
```

…captures stdout bytes, base64-encodes as `data:image/png;base64,...`.
Returns `{ ok: true, dataUrl }`. See
[`03-rust-backend.md#image_thumbnail`](./03-rust-backend.md#image_thumbnail).

**Alternative** (if you want to avoid a second ffmpeg invocation): add the
[`image`](https://crates.io/crates/image) crate with `png,jpeg,gif,bmp,webp,tiff`
features. Note AVIF/HEIC support there is limited — the ffmpeg approach is
strictly more compatible for an app whose whole job is ffmpeg-driven conversion.

---

## `probeImage(filePath, ffmpegPath)` ← `ffprobe:run`

**Electron**: spawns `ffprobe -v error -select_streams v:0 -show_entries
stream=width,height -of csv=p=0 <path>`, parses `"W,H"` → `{ ok, width,
height }`.

**Tauri**: Rust command, same ffprobe invocation:

```rust
#[tauri::command]
async fn probe_image(file_path: String, ffmpeg_path: Option<String>) -> ProbeImageResult {
    ffmpeg::probe_image(&file_path, &resolve_path(ffmpeg_path)).await
}
```

Parses the first `W,H` from stdout. Returns `{ ok, width, height }` /
`{ ok: false, error }`. Full source:
[`03-rust-backend.md#probe_image`](./03-rust-backend.md#probe_image).

---

## `onLog(callback)` ← `ffmpeg:log` event 

**Electron** (`preload.js`): `ipcRenderer.on("ffmpeg:log", handler)`, returns
an unsubscribe `() => ipcRenderer.removeListener(...)`.

**Tauri**: `bindings.ts` uses `listen` (returns a `Promise<UnlistenFn>`).
The store `await`s it on init and stores the unlisten fn for teardown:

```ts
export async function onLog(callback: (entry: LogEntry) => void): Promise<UnlistenFn> {
  return listen<LogEntry>("ffmpeg:log", (event) => callback(event.payload));
}
```

**Pitfall** (documented in Tauri docs): `listen` returns a Promise; calling
`unlisten` before it resolves unregisters immediately and receives nothing.
`bindings.ts` returns the `Promise<UnlistenFn>` and the store `await`s it in
`appState.init()` ([07-svelte-frontend.md#log-streaming](./07-svelte-frontend.md#log-streaming)),
so teardown always has a resolved unlisten fn.

---

## Validation: keep `ipc-validation.ts`

The frontend already validates payloads client-side via
`src/lib/logic/ipc-validation.ts` (jobId length, arg count/length caps). This
module is **pure TS, Electron-free** — it works unchanged in Tauri.
Additionally, replicate the critical bounds in Rust (max arg count 512, max arg
length 8192) as defense-in-depth in the `convert` command — see
[`03-rust-backend.md#validation`](./03-rust-backend.md#validation).

---

## Summary table

| `bindings.ts` function | Tauri impl | Rust command? |
|---|---|---|
| `getPlatform()` | `invoke("platform")` | ✅ 1-liner |
| `selectImages()` | dialog plugin `open()` | ❌ JS |
| `selectOutputDir()` | dialog plugin `open({directory})` | ❌ JS |
| `probeFfmpeg(p)` | `invoke("probe_ffmpeg")` | ✅ |
| `convert(payload)` | `invoke("convert")` + `ffmpeg:log` event | ✅ + event |
| `cancel(jobId)` | `invoke("cancel")` | ✅ |
| `showNotification(p)` | notification plugin | ❌ JS |
| `saveFile(p)` | dialog `save()` + `invoke("save_file")` | ✅ write only |
| `checkExists(p)` | `invoke("check_exists")` | ✅ |
| `getThumbnail(p)` | `invoke("image_thumbnail")` | ✅ (ffmpeg) |
| `probeImage(p,fp)` | `invoke("probe_image")` | ✅ |
| `onLog(cb)` | `listen("ffmpeg:log")` | ❌ event |

→ [03-rust-backend.md](./03-rust-backend.md) for the full Rust source.
