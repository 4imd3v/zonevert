# Zonevert: Electron → Tauri Migration

Migration plan from the current Electron 42 app (90–118 MB bundles) to Tauri 2
(~5–10 MB bundles) for Windows + Linux.

## Why migrate

The v0.1.0 bundles are 90–118 MB, but the **actual app code is 100 KB**. The
other 99.97% is the Electron 42 runtime (Chromium + Node + V8), which is
immutable — no config can shrink the ~200 MB Electron binary below ~60 MB
compressed. See the [bundle analysis](../README.md) for the full breakdown.

Tauri uses the **system WebView** (WebView2 on Windows, WebKitGTK on Linux)
instead of bundling a browser, so the final binary carries only the Rust core +
your 100 KB of web assets. Expected size: **5–10 MB**.

## The strategy (Svelte 5 + TypeScript rewrite of the renderer)

The current renderer is 38 KB of imperative DOM manipulation (`renderer.js` +
hand-written `getElementById` + manual `render*()` functions). Instead of
porting that verbatim into a shim, the Tauri frontend is rebuilt as **Svelte 5
+ TypeScript + Vite** — runes replace the manual state/render cycle, and the
IPC layer becomes a **typed `bindings.ts`** with full TypeScript signatures
for every command and result shape.

The **pure-logic modules** (`conversion-plan.js`, `queue-state.js`,
`ipc-validation.js`, `progress-parser.js`) port to `.ts` with added types — the
algorithms are unchanged, only the signatures gain types. These four files
hold the real business logic and their behavior is covered by the existing
`tests/*.test.cjs`.

Three things move:

| Layer | Electron | Tauri |
|---|---|---|
| Process backend | `src/main.js` (Node `spawn`) | `src-tauri/src/` (Rust `tokio::process::Command`) |
| Bridge | `src/preload.js` (`contextBridge`) | `src/lib/bindings.ts` (typed `invoke` wrappers) |
| Frontend | `src/renderer.js` (imperative DOM) | `src/lib/components/*.svelte` (Svelte 5 runes) |
| Packaging | `electron-builder` | `tauri build` (Vite for frontend) |

## IPC surface (the whole backend contract)

11 `ipcMain.handle` channels + 1 push event, all defined in `src/main.js` /
`src/preload.js`:

| `window.zonevert` method | Electron channel | Returns |
|---|---|---|
| `platform` (property) | `process.platform` | `"win32"` / `"linux"` / `"darwin"` |
| `selectImages()` | `dialog:select-images` | `[{ path, name }]` |
| `selectOutputDir()` | `dialog:select-output-dir` | `string` |
| `probeFFmpeg(ffmpegPath)` | `ffmpeg:probe` | `{ ok, code?, version?, error? }` |
| `convert(payload)` | `ffmpeg:convert` | `{ ok, code?, signal?, error? }` |
| `cancel(jobId)` | `ffmpeg:cancel` | `{ ok, error? }` |
| `showNotification(payload)` | `notification:show` | `{ ok, error? }` |
| `saveFile(payload)` | `dialog:save-file` | `{ ok, filePath?, canceled?, error? }` |
| `checkExists(filePath)` | `fs:check-exists` | `{ ok, exists? }` |
| `getThumbnail(filePath)` | `image:thumbnail` | `{ ok, dataUrl? }` |
| `probeImage(filePath, ffmpegPath)` | `ffprobe:run` | `{ ok, width?, height? }` |
| `onLog(callback)` | `ffmpeg:log` event (push) | unsubscribe `() => {}` |

Full per-handler mapping with Rust source: [`02-ipc-mapping.md`](./02-ipc-mapping.md).

## Roadmap

1. **[Setup](./01-setup.md)** — scaffold Vite + Svelte 5 + TS + Tauri, project structure, `tauri.conf.json`.
2. **[IPC mapping](./02-ipc-mapping.md)** — every handler, Electron → Tauri, with decisions.
3. **[Rust backend](./03-rust-backend.md)** — `Cargo.toml`, `lib.rs`, `commands.rs`, `ffmpeg.rs`, `state.rs` (full source).
4. **[Frontend](./04-frontend.md)** — typed `bindings.ts`, what stays/deletes, Vite integration.
5. **[Build & release](./05-build-release.md)** — bundlers, GitHub Actions cross-build, ffmpeg distribution.
6. **[Checklist](./06-checklist.md)** — verification + known gaps.
7. **[Svelte frontend](./07-svelte-frontend.md)** — component tree, state store, porting logic modules to TS, example components.

## Key decisions (read before starting)

1. **Vite + Svelte 5 + TypeScript.** The Electron renderer was vanilla JS
   with no bundler; the Tauri frontend uses Vite + Svelte 5 (runes) + TS.
   `withGlobalTauri` is off — the bindings module imports from
   `@tauri-apps/api` (npm), which Vite bundles. This gives full type safety on
   the IPC boundary instead of the untyped `window.zonevert` global. See
   [04-frontend.md](./04-frontend.md) and [07-svelte-frontend.md](./07-svelte-frontend.md).
2. **Spawn ffmpeg directly in Rust**, not via the `tauri-plugin-shell` scoped
   API. Zonevert passes **dynamic, user-built ffmpeg args**; the shell plugin's
   pre-configured arg validators can't express that. `tokio::process::Command`
   in a Tauri command handles it cleanly with full control. See
   [`02-ipc-mapping.md`](./02-ipc-mapping.md#convert).
3. **Logs via Tauri events, not Channels.** The Svelte store registers one
   global `onLog` callback for all jobs. A global `ffmpeg:log` event mirrors
   this exactly; per-call Channels would complicate the store. Log lines are
   small text (~few/sec), well within the event system's design. Channels are
   noted as the upgrade path if throughput ever matters.
4. **`platform` maps to Electron's values.** Tauri's os returns `"windows"` /
   `"linux"` / `"macos"`, but `conversion-plan.ts` checks `=== "win32"`. The
   `platform()` Rust command returns `"win32"` / `"linux"` / `"darwin"` so the
   path-quoting logic in `formatCommand` stays unchanged.
5. **Thumbnails via ffmpeg**, not the `image` crate. Zonevert already requires
   ffmpeg; `ffmpeg -i input -vf scale=48:-1 -f image2pipe -vframes 1 pipe:1`
   produces a PNG for any format ffmpeg reads (avif, heic, etc.) — zero new
   deps, wider format support than the `image` crate.

## What you give up

- **Auto-update**: Electron's `electron-updater` is turnkey. Tauri has an
  updater plugin but it needs a signing key + a JSON feed host. Out of scope for
  v0.1 port; document as a follow-up.
- **Crash reporting** (`chrome_crashpad_handler`): gone with Electron. Bring
  your own (e.g. `sentry`) or skip.
- **WebView variance**: WebKitGTK (Linux) ≠ WebView2 (Windows). Zonevert uses
  only vanilla DOM + CSS, no Canvas/WebGL/WebRTC, so this is a non-issue here.
  Flag any future use of advanced web APIs for cross-WebView testing.
