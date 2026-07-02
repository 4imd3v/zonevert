# Zonevert — Improvement Plan

> Generated from a full codebase audit covering every source file, test, script, and config.
> Baseline: 10/10 tests passing, ~2,800 lines across 14 files.

---

## Phase 1 — Security & Reliability (Critical) ✅

These are small, high-impact fixes that close real attack surfaces and prevent resource leaks.

### S1. Content Security Policy ✅
- [x] Add a CSP `<meta>` tag to `src/index.html` restricting `default-src`, `script-src`, `style-src`, and `img-src` to `'self'`
- [x] Allow `img-src 'self' data: blob:` if thumbnails (F7) are implemented later
- [x] Verify the app still loads correctly under the new CSP (no inline scripts, no external resources)

### S2. Navigation & new-window hardening ✅
- [x] In `createWindow()`, add `win.webContents.setWindowOpenHandler()` to deny or redirect to `shell.openExternal`
- [x] Add a `will-navigate` listener that prevents navigation away from the loaded `file://` URL
- [x] Require `const { shell } = require("electron")` in `main.js`

### R1. Kill child processes on app quit ✅
- [x] Add an `app.on("before-quit", ...)` handler that iterates `runningProcesses` and sends `SIGTERM` to each child
- [x] Clear the `runningProcesses` map after killing
- [ ] Test: start a large batch, close the window, confirm no orphan `ffmpeg` processes remain (`pgrep ffmpeg`)

### R2. onLog listener cleanup ✅
- [x] In `renderer.js`, store the cleanup function returned by `api.onLog()` so it can be called if the renderer ever re-initializes
- [x] Consider making `setupLogStream()` idempotent (guard against double-registration)

### R3. Renderer error boundary ✅
- [x] Wrap `init()` and all event handler bodies in `try/catch` blocks
- [x] On caught error, show a non-blocking message in the log panel rather than letting the UI go blank
- [x] Log the error stack to the console for debugging

---

## Phase 2 — Performance & UX Foundations (High) ✅

### P1. Debounce `renderAll()` on input events ✅
- [x] Add a `scheduleRender()` function with an 80ms debounce timer
- [x] Replace `renderAll` with `scheduleRender` in the `input` event listeners (format, quality, resize, ffmpeg args, etc.)
- [x] Keep instant `renderAll()` for user actions (add files, clear, convert, cancel, preset change)
- [ ] Test: typing in a text field should feel smooth even with 100+ files loaded

### P2. Targeted DOM updates instead of full `innerHTML` rewrites ✅
- [x] `renderFiles()`: diff or rebuild only the changed rows instead of replacing the entire list
- [x] `renderQueue()`: update individual queue item status classes/text without rebuilding the whole list
- [x] Preserve scroll position in both lists across re-renders
- [x] Preserve focus state (e.g., if a field is focused when a render fires)

### F1. Settings persistence ✅
- [x] Define a settings object: `format`, `preset`, `quality`, `overwrite`, `keepMetadata`, `resizeMode`, `width`, `height`, `ffmpegPath`, `globalArgs`, `inputArgs`, `filterGraph`, `outputArgs`, `outputDir`
- [x] Save to `localStorage` on every settings change (debounced)
- [x] Restore from `localStorage` on `init()` before `renderAll()`
- [x] Add a "Reset to defaults" button in the Advanced section
- [x] Handle schema migrations: if a stored key is missing or invalid, fall back to the default

---

## Phase 3 — Output Handling & Batch Quality (High)

### R4. Output filename collision detection ✅
- [x] When `createQueue()` builds the queue, collect all output paths and detect duplicates
- [x] For collisions, append a numeric suffix: `photo-1.webp`, `photo-2.webp`
- [x] Add a unit test in `tests/queue-state.test.cjs` covering multi-file stem collision
- [x] Show the resolved output path in the queue list UI

### F12. Collision strategy options ✅
- [x] Add a setting: "When output exists" with three modes: `overwrite` (current `-y`), `skip` (check existence, skip if file present), `rename` (auto-append number)
- [x] For `skip` mode, use Node `fs.existsSync` in the main process before launching FFmpeg
- [x] Expose via a new IPC handler: `fs:check-exists`
- [x] Update `queue-state.js` to support a `skipped` status

### F9. Retry failed conversions ✅
- [x] Add a "Retry failed" button next to the Convert button
- [x] Button is visible only when `queue` has items with `status === "failed"`
- [x] On click, reset all failed items to `pending` and re-run the conversion loop
- [x] Add `resetFailed(queue)` to `queue-state.js` with a unit test

### F10. Output filename customization ✅
- [x] Add a "Naming" section with options:
  - Suffix field (default: empty; `-converted` for same-format)
  - Prefix field (default: empty)
  - Sequential numbering toggle (001, 002, 003…)
  - Zero-padding width selector (1-5 digits)
- [x] Update `getOutputPath()` in `conversion-plan.js` to accept a naming config
- [x] Add unit tests for each naming mode

---

## Phase 4 — Features & Polish (Medium) ✅

### F2. Dark mode ✅
- [x] Define a dark palette in `styles.css` under `:root[data-theme="dark"]`
- [x] Add a theme toggle button in the topbar (sun/moon icon)
- [x] Persist preference in `localStorage` (ties into F1)
- [x] Respect `prefers-color-scheme: dark` on first launch if no stored preference
- [x] Update `color-scheme` CSS property to match active theme

### F3. System notification on completion ✅
- [x] In `main.js`, add `ipcMain.handle("notification:show", ...)` using Electron `Notification`
- [x] In `preload.js`, expose `showNotification({ title, body })`
- [x] In `renderer.js`, call it when the queue finishes (both success and partial-failure cases)
- [x] Include a summary: "3 done, 1 failed" in the body

### F4. Keyboard shortcuts ✅
- [x] `Ctrl+O` → Add files
- [x] `Ctrl+Enter` → Convert
- [x] `Escape` → Cancel current job
- [x] `Ctrl+Shift+C` → Copy command
- [x] `Ctrl+L` → Focus log panel
- [x] Add `accesskey` attributes to key buttons as a lightweight alternative
- [x] Show shortcut hints in button tooltips

### F5. Export commands as shell/batch script ✅
- [x] Add an "Export Script" button in the Command panel
- [x] Build the script content by iterating the queue and calling `formatCommand()` per item
- [x] On Electron: use `dialog.showSaveDialog` + `fs.writeFile` in the main process
- [x] On browser preview: download a `.txt` or `.sh` file via Blob URL
- [x] Platform-aware: `.sh` shebang on Linux, `.bat` on Windows

### F11. Log export ✅
- [x] Add a "Save Log" button in the Log panel header
- [x] Write `state.logs.join("")` to a user-chosen file path
- [x] Suggest a filename like `zonevert-log-YYYY-MM-DD.txt`

### P3. Parallel conversion (configurable concurrency) ✅
- [x] Add a "Parallel jobs" setting (1-8, default 1)
- [x] Replace the sequential `for` loop in `runConversion()` with a concurrency pool
- [x] Update `queue-state.js` to support multiple `running` items simultaneously
- [x] Ensure the progress bar and summary still compute correctly
- [x] Show which jobs are running in the queue list (multiple `running` rows)
- [x] Cancel button kills all running processes in parallel mode
- [x] Log streaming accepts logs from any running job

### P4. Per-file progress parsing ✅
- [x] Parse FFmpeg stderr lines for `frame=`, `fps=`, `time=` in `progress-parser.js`
- [x] Show a per-file progress bar or percentage in each queue row
- [x] Show an overall ETA based on average conversion time × remaining files
- [x] Module: `src/progress-parser.js` (UMD pattern, same as existing modules)
- [x] Test: feed sample FFmpeg stderr output and verify parsed values

---

## Phase 5 — Nice-to-Have Features (Low priority)

### F6. Save/load conversion profiles (skipped)

### F7. Image thumbnails in the file list ✅
- [x] In the Electron path: use `nativeImage.createFromPath(file.path).resize({ width: 48 })` in the main process
- [x] Expose via IPC handler: `image:thumbnail` returning a data URL
- [x] In the browser preview: use `URL.createObjectURL(file)` from the drop target
- [x] Cache thumbnails to avoid re-generation on re-renders
- [x] Show a 48×48 thumbnail next to the filename in each file row

### F8. ffprobe for image metadata ✅
- [x] Add a new IPC handler: `ffprobe:run` that calls `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 <file>`
- [x] Display source dimensions in the file list: `photo.png · 1920×1080`
- [x] Show "1600×900 → 800×450" in the Resize panel when a resize is active
- [x] Cache results per file path

### F13. Drag-and-drop reordering of the queue ✅
- [x] Allow dragging queue items to reorder them before conversion starts
- [x] Update `state.queue` array order on drop
- [x] Re-render the queue list
- [x] Disable reordering while conversion is running

### F14. App icon and packaging metadata ✅
- [x] Create a `build/icon.png` (512×512) and `build/icon.ico` for Windows (placeholder + docs)
- [x] Add `linux.icon` and `win.icon` to the `build` config in `package.json`
- [x] Add `author`, `license`, and `repository` fields to `package.json`
- [ ] Consider adding `app.dock.setIcon()` on macOS (if ever targeting macOS)

---

## Phase 6 — Code Quality & Tooling (Ongoing)

### C1. Type safety via JSDoc + tsc
- [ ] Add `// @ts-check` to the top of each `.js` file
- [ ] Write JSDoc `@typedef` and `@param` annotations for all exported functions
- [ ] Define shared types: `ConversionIntent`, `QueueItem`, `IpcPayload`, `ConversionResult`
- [ ] Add a `tsconfig.json` with `allowJs: true, checkJs: true, noEmit: true`
- [ ] Add `"typecheck": "tsc --noEmit"` to `package.json` scripts

### C2. Build step with esbuild
- [ ] Add `esbuild` as a dev dependency
- [ ] Convert `conversion-plan.js`, `queue-state.js`, `ipc-validation.js` from UMD to ESM `import/export`
- [ ] Create a `scripts/build-renderer.cjs` that bundles renderer modules into a single `dist/renderer.bundle.js`
- [ ] Update `index.html` to load the bundle instead of individual scripts
- [ ] Keep test files importing from source (ESM with `--experimental-vm-modules` or via a small CJS shim)

### C3. Split renderer into modules
- [ ] `src/renderer/state.js` — state object and mutation helpers
- [ ] `src/renderer/dom.js` — element references and render functions
- [ ] `src/renderer/events.js` — listener setup and keyboard shortcuts
- [ ] `src/renderer/actions.js` — async operations (convert, probe, addFiles, copyCommand)
- [ ] `src/renderer/index.js` — `init()` entry point that wires everything together
- [ ] Extract pure functions (`dedupeFiles`, `canRunConversion`, `buildCommand`) into a testable module

### C4. Dev script with auto-reload
- [ ] Add `electron-reload` or a Vite dev server for hot reload during development
- [ ] Add `"dev": "electron-reload --no-sandbox ."` or equivalent to `package.json`
- [ ] Document the dev workflow in the README

### C5. Expanded test coverage
- [ ] Test edge cases in `conversion-plan`: empty paths, unicode filenames, very long args
- [ ] Test `renderer.js` pure functions after extraction (C3)
- [ ] Add integration test: mock IPC, run a full queue lifecycle (create → run → mark → summarize)
- [ ] Add a `lint` script (ESLint with `eslint:recommended`)
- [ ] Add CI via GitHub Actions: run `pnpm run check` on every push

### C6. Accessibility audit
- [ ] Add `role="log"` and `aria-live="polite"` to the log output `<pre>`
- [ ] Add `role="status"` to the queue progress bar container
- [ ] Add `aria-label` to the progress bar (`aria-valuenow`, `aria-valuemin`, `aria-valuemax`)
- [ ] Ensure all interactive elements have visible focus indicators (already partially done via `:focus-visible`)
- [ ] Test with a screen reader (NVDA or VoiceOver) to verify the queue and log are announced
- [ ] Add `aria-busy="true"` to the convert button while converting

---

## Implementation Order

```
Phase 1 (Critical)     ████████████████████  Security & reliability — do first
Phase 2 (High)         ████████████████      Performance & settings — biggest UX wins
Phase 3 (High)         ████████████████      Output handling — prevents data loss
Phase 4 (Medium)       ████████████          Features & polish — user-facing value
Phase 5 (Low)          ████████              Nice-to-haves — when time allows
Phase 6 (Ongoing)      ████████████████████  Code quality — incremental, alongside phases
```

### Recommended sequence

1. **S1 + S2 + R1** — Security hardening (1 session, ~30 min)
2. **P1** — Debounce renderAll (quick win, unblocks Phase 2)
3. **F1** — Settings persistence (ties into F2, F4, F12)
4. **R4 + F12** — Collision handling (prevents silent overwrites)
5. **F3 + F4** — Notifications + shortcuts (quick, high perceived value)
6. **F2** — Dark mode (leveraging existing CSS variable system)
7. **C1** — JSDoc type annotations (foundation for all future work)
8. **P3 + P4** — Parallel conversion + progress parsing
9. **C3** — Split renderer (best done after features stabilize)
10. **C2 + C4** — Build step + dev tooling (final modernization)
