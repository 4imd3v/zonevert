# 4. Frontend — Typed Bindings + Vite

The Electron `contextBridge` preload is replaced by a **typed `bindings.ts`**
module that wraps Tauri's `invoke` / plugin APIs with full TypeScript
signatures. Svelte components import these functions directly — no global
`window.zonevert`, no shim, no `withGlobalTauri`.

## `src/lib/bindings.ts`

Replaces `src/preload.js`. Every command and result shape is typed; the Rust
serde structs (camelCase) map 1:1 to these interfaces.

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// ---- result types (mirror the Rust serde structs in 03-rust-backend.md) ----

export interface ProbeResult {
  ok: boolean;
  code?: number;
  version?: string;
  error?: string;
}

export interface ConvertResult {
  ok: boolean;
  code?: number;
  signal?: string;
  error?: string;
}

export interface CancelResult {
  ok: boolean;
  error?: string;
}

export interface ExistsResult {
  ok: boolean;
  exists: boolean;
}

export interface SaveResult {
  ok: boolean;
  filePath: string;
  error?: string;
  canceled?: boolean;
}

export interface ThumbnailResult {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export interface ProbeImageResult {
  ok: boolean;
  width?: number;
  height?: number;
  error?: string;
}

export interface SelectedImage {
  path: string;
  name: string;
}

export interface LogEntry {
  jobId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface ConvertPayload {
  jobId: string;
  ffmpegPath?: string;
  args: string[];
}

const IMAGE_EXTENSIONS = [
  "apng", "avif", "bmp", "gif", "heic", "heif",
  "jpeg", "jpg", "png", "tif", "tiff", "webp",
];

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

// ---- bindings ----

/** Returns Electron-style platform strings ("win32"/"linux"/"darwin")
 *  so conversion-plan.ts path-quoting (`=== "win32"`) needs no changes. */
export async function getPlatform(): Promise<string> {
  return invoke<string>("platform");
}

export async function selectImages(): Promise<SelectedImage[]> {
  const result = await open({
    multiple: true,
    directory: false,
    filters: [
      { name: "Images", extensions: IMAGE_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result) return [];
  const list = Array.isArray(result) ? result : [result];
  return list.map((p) => ({ path: p, name: basename(p) }));
}

export async function selectOutputDir(): Promise<string> {
  const result = await open({ directory: true, multiple: false });
  return result ?? "";
}

export async function probeFfmpeg(ffmpegPath?: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_ffmpeg", { ffmpegPath });
}

export async function convert(payload: ConvertPayload): Promise<ConvertResult> {
  return invoke<ConvertResult>("convert", { payload });
}

export async function cancel(jobId: string): Promise<CancelResult> {
  return invoke<CancelResult>("cancel", { jobId });
}

export async function checkExists(filePath: string): Promise<ExistsResult> {
  return invoke<ExistsResult>("check_exists", { path: filePath });
}

export async function getThumbnail(filePath: string): Promise<ThumbnailResult> {
  return invoke<ThumbnailResult>("image_thumbnail", { filePath });
}

export async function probeImage(
  filePath: string,
  ffmpegPath?: string,
): Promise<ProbeImageResult> {
  return invoke<ProbeImageResult>("probe_image", { filePath, ffmpegPath });
}

export async function saveFile(payload: {
  title?: string;
  defaultPath?: string;
  content: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<SaveResult> {
  if (typeof payload.content !== "string") {
    return { ok: false, filePath: "", error: "File content is required." };
  }
  const filePath = await save({
    title: payload.title ?? "Save file",
    defaultPath: payload.defaultPath ?? "output.txt",
    filters: payload.filters ?? [{ name: "Text", extensions: ["txt"] }],
  });
  if (!filePath) return { ok: false, filePath: "", canceled: true };
  return invoke<SaveResult>("save_file", { filePath, content: payload.content });
}

export async function showNotification(payload: {
  title: string;
  body?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (typeof payload.title !== "string") {
    return { ok: false, error: "Notification title is required." };
  }
  let granted = await isPermissionGranted();
  if (!granted) {
    const p = await requestPermission();
    granted = p === "granted";
  }
  if (!granted) {
    return { ok: false, error: "Notifications not supported on this platform." };
  }
  sendNotification({
    title: payload.title,
    body: payload.body ?? "",
  });
  return { ok: true };
}

/** Subscribe to global ffmpeg:log events. Returns an unsubscribe function. */
export async function onLog(callback: (entry: LogEntry) => void): Promise<UnlistenFn> {
  // Tauri's listen() returns a Promise<UnlistenFn>. The store awaits it
  // (see 07-svelte-frontend.md) so teardown is always safe.
  return listen<LogEntry>("ffmpeg:log", (event) => callback(event.payload));
}
```

### Notes

- **No `window.zonevert` global.** Svelte components `import { convert, ... }`
  from `$lib/bindings` — idiomatic, tree-shakeable, fully typed. The old
  `renderer.js` line 2 (`const api = window.zonevert`) is gone.
- **`onLog` returns `Promise<UnlistenFn>`** (not a sync unsubscribe). The
  state store (see [07](./07-svelte-frontend.md#log-streaming)) `await`s it on
  init and stores the unlisten fn for teardown. This sidesteps the Tauri
  pitfall of calling unlisten before the promise resolves.
- **`getPlatform` is async.** The store calls it once during initialization and
  caches the result. Components read the cached value (a `$state` field), so no
  async-in-template issues.

## `src/app.html` (Vite template)

Replaces `src/index.html`. Plain Vite + Svelte uses a standard HTML file with a
mount point + a module script — **no** SvelteKit `%svelte.head%` / `%svelte.body%`
placeholders (those are SvelteKit-only). Vite injects the bundled entry
(`src/main.ts`) via the `<script type="module">` tag:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zonevert</title>
    <!-- CSP is set in tauri.conf.json; don't duplicate the meta tag here -->
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

The SVG icon `<symbol>` defs from the old `index.html` move into `App.svelte`
(or a shared `Icon.svelte` component) so they're part of the Svelte tree.

## `src/main.ts`

Mounts the Svelte app:

```ts
import { mount } from "svelte";
import "./styles.css";
import App from "./lib/components/App.svelte";

const app = mount(App, { target: document.getElementById("app")! });

export default app;
```

## Files deleted after verification

Once the Svelte port runs end-to-end:

| File | Why gone |
|---|---|
| `src/preload.js` | `contextBridge` is Electron-only; `bindings.ts` replaces it |
| `src/main.js` | Node main process; Rust `src-tauri/src/` replaces it |
| `src/renderer.js` | imperative DOM logic → Svelte components (see 07) |
| `src/index.html` | replaced by `src/app.html` (Vite template) |
| `scripts/install-electron-runtime.cjs` | Electron binary downloader |
| `scripts/dev.js` | electron-reload wrapper; `tauri dev` uses Vite HMR |
| devDeps: `electron`, `electron-builder`, `electron-reload` | runtime + packager |

## Files ported (logic modules → `.ts`)

These are **not** rewritten — the algorithms stay identical. Only types are
added and the UMD wrapper becomes ESM `export`:

| Electron | Tauri | Changes |
|---|---|---|
| `src/conversion-plan.js` | `src/lib/logic/conversion-plan.ts` | UMD → ESM exports, add interfaces for `ConversionIntent`, `ConversionPlan`, `NamingOptions` |
| `src/queue-state.js` | `src/lib/logic/queue-state.ts` | UMD → ESM, type the `QueueItem` shape |
| `src/ipc-validation.js` | `src/lib/logic/ipc-validation.ts` | UMD → ESM, type the validation result union |
| `src/progress-parser.js` | `src/lib/logic/progress-parser.ts` | UMD → ESM, type the `ProgressFrame` |

See [07-svelte-frontend.md](./07-svelte-frontend.md#porting-logic-modules) for
the ported signatures.

## Files unchanged

- `src/styles.css` — global styles, moved to `src/styles.css` (Vite root).
  Svelte components use scoped `<style>` for component-specific CSS; the
  existing global classes (`.panel`, `.field`, `.toggle`, etc.) move into
  `App.svelte`'s `<style>` or stay global — see [07](./07-svelte-frontend.md#styling).
- `tests/*.test.cjs` — test the logic modules; the `.ts` ports export the same
  function names, so tests pass unchanged (run via `tsx` or compile step).

→ [07-svelte-frontend.md](./07-svelte-frontend.md) for the component tree + state store.
