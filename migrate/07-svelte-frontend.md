# 7. Svelte Frontend — Components, State, Logic Ports

The Electron `renderer.js` (38 KB of `getElementById` + manual `render*()`
functions) becomes a Svelte 5 component tree with runes-based state. This doc
covers: the component breakdown, the shared state store, porting the logic
modules to TypeScript, and two example components.

## Component tree

Derived from the `index.html` markup. Each panel maps to one Svelte component.

```
App.svelte
├─ Topbar.svelte            (brand, ffmpeg status dot, theme toggle)
├─ SummaryStrip.svelte      (files / format / quality / output)
└─ Workspace.svelte         (two-column grid)
   ├─ .setup-column
   │  ├─ SourcePanel.svelte       (drop target, file list, thumbnails)
   │  ├─ OutputPanel.svelte       (format, preset, quality, toggles, collision)
   │  ├─ NamingPanel.svelte       (prefix, suffix, sequential, pad)
   │  ├─ ResizePanel.svelte       (mode, width, height)
   │  └─ AdvancedPanel.svelte     (ffmpeg path, concurrency, args, probe/reset)
   └─ .run-column
      ├─ CommandPanel.svelte     (preview <pre>, copy, export)
      ├─ QueuePanel.svelte       (progress bar, queue list, convert/cancel)
      └─ LogPanel.svelte         (log <pre>, clear, save)
```

Plus a shared `Icon.svelte` for the SVG `<symbol>` defs (moved from `index.html`).

## State store: `src/lib/stores/app-state.svelte.ts`

Svelte 5's recommended pattern for shared state is a **class with `$state`
fields** (per the Svelte best practices skill — prefer classes over stores for
cross-component reactivity). This replaces the global `state` object in
`renderer.js` (line 7) and the manual `render*()` functions.

The fields mirror the Electron `state` object exactly:

```ts
// src/lib/stores/app-state.svelte.ts
import { getPlatform, onLog, type LogEntry, type SelectedImage } from "$lib/bindings";

export interface QueueItem {
  jobId: string;
  file: SelectedImage;
  status: "pending" | "running" | "done" | "error" | "canceled";
  progress?: string;   // formatted progress text
  error?: string;
}

class AppState {
  // ---- source files ----
  files = $state<SelectedImage[]>([]);
  thumbnails = $state.raw<Map<string, string>>(new Map());   // path -> dataUrl (raw: reassigned, not mutated)
  imageMeta = $state.raw<Map<string, string>>(new Map());    // path -> "W×H"

  // ---- output settings ----
  outputDir = $state("");

  // ---- conversion state ----
  isConverting = $state(false);
  activeJobId = $state("");
  cancelRequested = $state(false);
  queue = $state<QueueItem[]>([]);

  // ---- logs ----
  logs = $state<string[]>([]);
  private logUnlisten: (() => void) | null = null;

  // ---- platform (cached once) ----
  platform = $state("linux");
  private platformReady = false;

  // ---- ffmpeg status ----
  ffmpegStatus = $state<"idle" | "ok" | "error">("idle");
  ffmpegVersion = $state("");

  // ---- lifecycle ----

  async init() {
    if (this.platformReady) return;
    this.platform = await getPlatform();
    this.platformReady = true;

    // Subscribe to global ffmpeg:log events once.
    // await ensures teardown is safe (avoids the listen-before-resolve pitfall).
    this.logUnlisten = await onLog((entry) => this.appendLog(entry));
  }

  destroy() {
    this.logUnlisten?.();
    this.logUnlisten = null;
  }

  // ---- log streaming {#log-streaming} ----

  appendLog(entry: LogEntry) {
    const normalized = entry.text.replace(/\r/g, "\n");
    this.logs.push(normalized);
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
    // $state arrays are deeply reactive — push triggers UI update.
    // Auto-scroll is handled in LogPanel.svelte via an $effect.
  }

  clearLogs() {
    this.logs = [];
  }

  // ---- derived: can we convert? ----
  get canConvert(): boolean {
    return this.files.length > 0 && !this.isConverting;
  }
}

// Singleton — imported by every component.
// ponytail: module singleton; switch to Svelte context if multi-window added.
export const appState = new AppState();
```

### Why `$state.raw` for the Maps

Per the Svelte best practices skill: thumbnails/imageMeta are **reassigned**
(`new Map(...)` with new entries), not mutated in place, so deep reactivity
(proxies) is unnecessary overhead. `$state.raw` skips the proxy. When you add a
thumbnail, build a new Map: `state.thumbnails = new Map(state.thumbnails).set(path, url)`.

### Log streaming

`appendLog` (in the store above) normalizes line endings, caps the buffer at
500 entries (matching the Electron `state.logs` cap), and pushes to the
`$state` array — the deep-reactive proxy makes `push` trigger UI updates
automatically, so `LogPanel.svelte` re-renders without a manual `renderLogs()`.
Auto-scroll is the one legitimate `$effect` use (see the LogPanel example
below).

### Why a class, not stores

The Svelte skill explicitly recommends classes with `$state` fields over
writable stores for shared cross-component state. Components access fields
directly: `appState.files`, `appState.isConverting` — reactivity flows
automatically through the `$state` proxy. No `import { readable }` boilerplate.

## Porting logic modules

The four pure-logic modules (`conversion-plan.js`, `queue-state.js`,
`ipc-validation.js`, `progress-parser.js`) are UMD-wrapped. The port: drop the
UMD wrapper, add `export`, add types. **Algorithms are unchanged.**

### `conversion-plan.ts` (signatures)

```ts
export type OutputFormat = "webp" | "jpg" | "png" | "avif" | "tiff" | "bmp" | "gif";
export type Preset = "balanced" | "quality" | "small" | "lossless";
export type CollisionMode = "overwrite" | "skip" | "rename";
export type ResizeMode = "none" | "inside" | "fill" | "stretch";

export interface NamingOptions {
  prefix: string;
  suffix: string;
  sequential: boolean;
  padWidth: number;
}

export interface ConversionIntent {
  format: OutputFormat;
  preset: Preset;
  quality: number;
  overwrite: boolean;
  collisionMode: CollisionMode;
  keepMetadata: boolean;
  outputDir: string;
  ffmpegPath: string;
  resize: { mode: ResizeMode; width: number; height: number };
  naming: NamingOptions;
  advanced: {
    globalArgs: string[];
    inputArgs: string[];
    filterGraph: string;
    outputArgs: string[];
  };
}

export interface ConversionPlan {
  file: { path: string; name: string };
  outputPath: string;
  args: string[];
}

export function createConversionIntent(options: Record<string, unknown>): ConversionIntent;
export function planConversion(file: { path: string; name: string }, intent: ConversionIntent): ConversionPlan;
export function formatCommand(args: string[], options?: { platform?: string }): string;
export function basename(filePath: string): string;
export function extension(name: string): string;
export function stem(name: string): string;
export const PRESET_DEFAULTS: Record<Preset, { quality: number }>;
```

The function bodies are **copied verbatim** from `conversion-plan.js` — only
the UMD `factory()` wrapper is removed and `return { ... }` becomes `export`.

### `queue-state.ts` (signatures)

```ts
export type QueueItemStatus = "pending" | "running" | "done" | "error" | "canceled";

export interface QueueItem {
  id: string;
  file: { path: string; name: string };
  status: QueueItemStatus;
  progress?: string;
  error?: string;
}

export function createQueue(
  files: { path: string; name: string }[],
  intent: ConversionIntent,
  planner: (file: { path: string; name: string }) => ConversionPlan,
  createId?: () => string,
): QueueItem[];
export function resolveCollisions(queue: QueueItem[]): QueueItem[];
export function summarizeQueue(queue: QueueItem[]): { total: number; pending: number; done: number; error: number };
```

### `progress-parser.ts` (signatures)

```ts
export interface ProgressFrame {
  frame: number | null;
  fps: number | null;
  time: string | null;
  sizeKb: number | null;
}

export function parseLine(line: string): ProgressFrame | null;
export function parseStderr(text: string): ProgressFrame | null;
export function timeToSeconds(timeStr: string | null): number | null;
```

### `ipc-validation.ts` (signatures)

```ts
export interface ValidationOk<T> { ok: true; value: T; }
export interface ValidationErr { ok: false; error: string; }
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export function validateProbePayload(payload: unknown): ValidationResult<{ ffmpegPath: string }>;
export function validateConversionPayload(payload: unknown): ValidationResult<{ jobId: string; ffmpegPath: string; args: string[] }>;
export function validateCancelPayload(payload: unknown): ValidationResult<{ jobId: string }>;
```

### Tests stay unchanged

`tests/*.test.cjs` call the exported functions by name. The `.ts` ports export
the same names, so the tests pass. Run them with `node --test` — they import the
`.ts` via `tsx` or you keep a `.js` re-export. Simplest: the tests already
`require("./conversion-plan")`; if the file is `.ts`, add `tsx` as a test
loader, or keep a thin `.js` barrel that re-exports from `.ts`. See
[06-checklist.md](./06-checklist.md) for the test-runner decision.

## Example: `SourcePanel.svelte`

Shows the runes patterns: `$props`, `$state`, `$derived`, keyed `{#each}`,
event handlers (`onclick` / `onkeydown`), and store access.

```svelte
<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { selectImages, getThumbnail, probeImage } from "$lib/bindings";
  import { basename, extension } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";

  // Local UI state
  let dragOver = $state(false);

  // Derived: the empty-state shows when no files
  let isEmpty = $derived(appState.files.length === 0);

  async function addFiles() {
    const selected = await selectImages();
    if (!selected.length) return;
    appState.files = [...appState.files, ...selected];
    loadThumbnailsAndMeta(selected);
  }

  function removeFile(index: number) {
    appState.files = appState.files.filter((_, i) => i !== index);
  }

  async function loadThumbnailsAndMeta(files: SelectedImage[]) {
    const thumbs = new Map(appState.thumbnails);
    const meta = new Map(appState.imageMeta);
    await Promise.all(files.map(async (file) => {
      const [thumb, dims] = await Promise.all([
        getThumbnail(file.path),
        probeImage(file.path),
      ]);
      if (thumb.ok && thumb.dataUrl) thumbs.set(file.path, thumb.dataUrl);
      if (dims.ok && dims.width) meta.set(file.path, `${dims.width}×${dims.height}`);
    }));
    appState.thumbnails = thumbs;   // $state.raw: reassign, don't mutate
    appState.imageMeta = meta;
  }

  // Tauri drag-drop: the HTML5 `ondrop` event's `File` objects have NO `.path`
  // in the WebView (WebKitGTK/WebView2 don't expose it). Use Tauri's
  // `onDragDropEvent` instead, which delivers real file paths. Register it
  // once in App.svelte's onMount (see 07 → "App.svelte (root)") and route
  // paths here via the store. The <button> drop-target below is the click
  // path (selectImages dialog); native drag-drop is wired through the window.
  // ponytail: omit the HTML5 ondrop/ondragover handlers — they can't read paths.
</script>

<section class="panel" aria-labelledby="sourceTitle">
  <div class="panel-header">
    <div>
      <h2 id="sourceTitle">Source</h2>
      <p>{appState.files.length === 1 ? "1 file selected" : `${appState.files.length} files selected`}</p>
    </div>
    <div class="button-row">
      <button class="icon-button" onclick={addFiles} aria-label="Add images" title="Add images (Ctrl+O)">
        <Icon name="plus" />
      </button>
      <button class="icon-button" onclick={() => (appState.files = [])} aria-label="Clear images" title="Clear images">
        <Icon name="trash" />
      </button>
    </div>
  </div>

  <button
    class="drop-target"
    class:drop-target--active={dragOver}
    onclick={addFiles}
    type="button"
  >
    <span class="drop-icon" aria-hidden="true"><Icon name="image" /></span>
    <span class="drop-copy">
      <strong>Choose or drop images</strong>
      <small>JPG, PNG, WebP, AVIF, TIFF, BMP, GIF</small>
    </span>
  </button>

  <div class="file-list" aria-live="polite">
    {#if isEmpty}
      <div class="empty-state">
        <Icon name="alert" />
        <span>Add images to start building the FFmpeg command.</span>
      </div>
    {:else}
      {#each appState.files as file, index (file.path)}
        <div class="file-row">
          <img class="file-thumb" src={appState.thumbnails.get(file.path)} alt="" />
          <div class="file-info">
            <strong>{file.name || basename(file.path)}</strong>
            <span>{extension(file.name || file.path).toUpperCase() || "IMAGE"}</span>
            <span class="file-dimensions">{appState.imageMeta.get(file.path) ?? ""}</span>
          </div>
          <button
            class="icon-button file-remove-button"
            onclick={() => removeFile(index)}
            aria-label="Remove {file.name || 'file'}"
            title="Remove"
            type="button"
          >
            <Icon name="x" />
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>
```

### Patterns to note

- **`$derived` for computed** — `isEmpty` recomputes when `files` changes. No
  manual `renderFiles()` call.
- **Keyed `{#each}`** — `(file.path)` as the key, not the index (Svelte best
  practice: surgical DOM updates on add/remove).
- **`$state.raw` Map reassignment** — `appState.thumbnails = new Map(...)` not
  `.set()` on the proxy. Triggers update without per-entry proxying.
- **`onclick` / `ondrop`** — Svelte 5 attribute syntax, not `on:click`.
- **No `$effect` for rendering** — the template reads `appState.files`
  directly; reactivity flows. `$effect` is reserved for auto-scroll (LogPanel)
  and platform init.

## Example: `LogPanel.svelte`

Shows the `$effect` escape hatch (auto-scroll) and the log cap:

```svelte
<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { saveFile } from "$lib/bindings";

  let logEl = $state<HTMLPreElement>();

  // Auto-scroll to bottom when logs change — the one legitimate $effect use.
  $effect(() => {
    void appState.logs.length;   // track dependency
    if (logEl) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  });

  let summary = $derived(
    appState.isConverting ? "Converting…" : appState.logs.length ? "Idle" : "Idle"
  );

  async function exportLog() {
    const content = appState.logs.join("");
    await saveFile({ content, defaultPath: `zonevert-log-${Date.now()}.txt` });
  }
</script>

<section class="panel log-panel" aria-labelledby="logTitle">
  <div class="panel-header">
    <div>
      <h2 id="logTitle">Log</h2>
      <p>{summary}</p>
    </div>
    <button class="icon-button" onclick={() => appState.clearLogs()} aria-label="Clear log" title="Clear log">
      ✕
    </button>
    <button class="icon-button" onclick={exportLog} aria-label="Save log" title="Save log to file">
      📁
    </button>
  </div>
  <pre bind:this={logEl} tabindex="0" role="log" aria-live="polite">{appState.logs.join("")}</pre>
</section>
```

## `App.svelte` (root)

Wires the tree together and initializes the store:

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { appState } from "$lib/stores/app-state.svelte";
  import { probeFfmpeg, type SelectedImage } from "$lib/bindings";
  import Topbar from "./Topbar.svelte";
  import SummaryStrip from "./SummaryStrip.svelte";
  import Workspace from "./Workspace.svelte";

  onMount(async () => {
    await appState.init();           // loads platform + subscribes to logs
    const probe = await probeFfmpeg();
    appState.ffmpegStatus = probe.ok ? "ok" : "error";
    appState.ffmpegVersion = probe.version ?? "";

    // Native drag-drop — delivers real file paths (HTML5 ondrop can't in WebView).
    // ponytail: filter by image extension here; the list lives in SourcePanel.
    const win = getCurrentWebviewWindow();
    const unlisten = await win.onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const imgExt = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
      const files: SelectedImage[] = e.payload.paths
        .filter((p) => imgExt.test(p))
        .map((p) => ({ path: p, name: p.split(/[/\\]/).pop()! }));
      if (files.length) appState.files = [...appState.files, ...files];
    });
    return unlisten;   // Svelte calls this on unmount
  });
</script>

<main class="app-shell">
  <Topbar />
  <SummaryStrip />
  <Workspace />
</main>

<style>
  /* Global layout — component-specific CSS is scoped in each .svelte */
  .app-shell { display: flex; flex-direction: column; min-height: 100vh; }
</style>
```

`onMount` returning the `unlisten` fn is the Svelte idiom for cleanup on unmount.

## Styling

Two layers:

1. **Global** (`src/styles.css`, imported in `main.ts`) — resets, CSS custom
   properties (theme tokens), and the shared component classes (`.panel`,
   `.field`, `.toggle`, `.drop-target`, `.file-row`, etc.) from the existing
   `styles.css`. These stay global because they're shared across panels.
2. **Scoped** (each component's `<style>`) — layout specific to that panel.

Svelte 5's `<style>` is scoped by default. For classes referenced in global CSS
that also appear in components, no change needed — the scoping adds an attribute,
the class still matches. Move the existing `styles.css` wholesale into
`src/styles.css`; split panel-specific rules into component `<style>` as you go.

## Theme toggle

The current theme toggle writes to `localStorage["zonevert:theme"]` and toggles a
class on `<html>`. In Svelte, keep this as a tiny `$state` in the store or a
local component state + `$effect` that syncs to `localStorage` and
`document.documentElement`. The CSS (light/dark via `:root[data-theme="dark"]`)
stays in global styles — no change to the CSS itself.

→ [06-checklist.md](./06-checklist.md) for verification.
