# 6. Migration Checklist & Known Gaps

Verification steps before deleting the Electron code and tagging `v0.2.0-tauri`.
Work top-to-bottom; each gates the next.

## Phase 1 — Scaffold (no behavior yet)

- [ ] Rust toolchain installs: `rustc --version` (≥ 1.77.2)
- [ ] `pnpm create tauri-app` (or manual `tauri init`) completes; `src-tauri/` + `vite.config.ts` + `svelte.config.js` exist
- [ ] `pnpm tauri add dialog && pnpm tauri add notification` add both plugins
- [ ] `tauri.conf.json` matches [05-build-release.md](./05-build-release.md) (full file) — `frontendDist: ../dist`, `devUrl`, `beforeDevCommand`/`beforeBuildCommand` set
- [ ] `pnpm tauri icon build/icon.png` generates all icon sizes in `src-tauri/icons/`
- [ ] `pnpm dev` starts Vite at `http://localhost:5173` (strictPort)
- [ ] `pnpm tauri dev` opens a window titled "Zonevert" at 1280×860, min 920×680, with Vite HMR
- [ ] `svelte-check --tsconfig ./tsconfig.json` passes clean

## Phase 2 — Rust backend

- [ ] `src-tauri/src/lib.rs`, `commands.rs`, `ffmpeg.rs`, `state.rs` written (from [03-rust-backend.md](./03-rust-backend.md))
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes clean
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — the dimensions-CSV parse test passes
- [ ] The PID-based cancel path compiles (`nix` on unix, `windows-sys` on windows) — see the note in [03-rust-backend.md#staters](./03-rust-backend.md#staters)
- [ ] `capabilities/default.json` grants `core:event:allow-listen` + `dialog`/`notification` defaults

## Phase 3 — Frontend bindings + state

- [ ] `src/lib/bindings.ts` created with all 12 typed functions (from [04-frontend.md](./04-frontend.md))
- [ ] `src/lib/stores/app-state.svelte.ts` created (from [07-svelte-frontend.md](./07-svelte-frontend.md))
- [ ] `src/main.ts` mounts `App.svelte`; `src/app.html` has the Vite template placeholders
- [ ] Logic modules ported to `.ts`: `conversion-plan.ts`, `queue-state.ts`, `ipc-validation.ts`, `progress-parser.ts` — UMD wrapper removed, ESM exports added, types added (algorithms unchanged)
- [ ] `svelte-check` passes clean across all `.svelte` + `.ts` files
- [ ] `pnpm build` (Vite) produces `dist/` with no errors
- [ ] CSP: no console errors about blocked inline scripts/styles. If blocked → adjust `app.security.csp`.

## Phase 4 — Functional parity (one-by-one against the Electron build)

Run each `bindings.ts` function from the browser devtools console (import via
the module graph, or add a temporary `window.__dbg` export) and confirm
identical behavior:

- [ ] **`getPlatform()`** → resolves `"win32"` (Windows) / `"linux"` (Linux)
- [ ] **`selectImages()`** → opens multi-select dialog; returns `[{path, name}]`; cancel returns `[]`
- [ ] **`selectOutputDir()`** → returns a string path; cancel returns `""`
- [ ] **`probeFfmpeg("ffmpeg")`** → `{ok:true, version:"ffmpeg version ..."}` when present; `{ok:false, error}` when not
- [ ] **`convert({jobId, ffmpegPath, args})`** → resolves `{ok:true, code:0}`; `ffmpeg:log` events fire during run
- [ ] **`onLog(cb)`** → callback receives `{jobId, stream, text}` for the running job; the returned unlisten stops it
- [ ] **`cancel(jobId)`** mid-run → `{ok:true}` and the process dies; resolve becomes `{ok:false, ...}`
- [ ] **`checkExists(path)`** → `{ok:true, exists:true/false}`
- [ ] **`getThumbnail(path)`** → `{ok:true, dataUrl:"data:image/png;base64,..."}`; renders as an `<img>` src
- [ ] **`probeImage(path, "ffmpeg")`** → `{ok:true, width, height}` for a real image
- [ ] **`saveFile({content, ...})`** → writes the file at the chosen path; cancel returns `{ok:false, canceled:true}`
- [ ] **`showNotification({title, body})`** → native notification appears; first call may prompt for permission

## Phase 5 — End-to-end UI run

- [ ] Full conversion flow: select images → set output dir/options → convert → log streaming appears → output files written → completion notification fires
- [ ] Cancel button kills the running ffmpeg and the queue advances correctly
- [ ] Thumbnails render in the file list (`$state.raw` Map reassignment works)
- [ ] `conversion-plan.ts` `formatCommand` still produces Windows-safe quoting (`platform === "win32"` branch) — confirms the platform string mapping
- [ ] Dark/light theme toggle still works (CSS unchanged, toggle via store `$effect`)
- [ ] `node --test tests/*.test.cjs` still green (logic modules ported, same exports)

## Phase 6 — Cross-platform build

- [ ] **Linux local**: `pnpm package:linux` produces `.deb` + `.AppImage` in `release/`; sizes ≈ 4–12 MB
- [ ] **Windows CI** (or local Windows): `pnpm package:windows` produces NSIS `.exe` + `.msi`; sizes ≈ 5–9 MB
- [ ] `.deb` installs on a clean Ubuntu: `sudo apt install ./zonevert_*.deb` and either ffmpeg is pulled (`Depends`) or the app's probe warns cleanly
- [ ] NSIS installer runs on a clean Windows 11; app launches; WebView2 bootstrapper downloads if missing
- [ ] The action uploads all four artifacts to the GitHub Release (see [05-build-release.md](./05-build-release.md#github-actions))

## Phase 7 — Cleanup

Only after Phase 6 is green on both OSes:

- [ ] Delete `src/main.js`, `src/preload.js`, `src/renderer.js`, `src/index.html`
- [ ] Delete `scripts/install-electron-runtime.cjs`, `scripts/dev.js`
- [ ] Remove devDeps: `electron`, `electron-builder`, `electron-reload`
- [ ] Update `package.json` scripts to the Tauri + Vite set ([01-setup.md](./01-setup.md#packagejson-scripts))
- [ ] Update `README.md` build instructions (Electron → Tauri + Svelte)
- [ ] Commit, tag `v0.2.0-tauri`, push to trigger the release workflow

## Known gaps & follow-ups

| Gap | Impact | Fix |
|---|---|---|
| **Auto-update** | no in-app updater | wire `tauri-plugin-updater` + signing key + `latest.json` feed on the GH Release |
| **Crash reporting** | none (Electron's crashpad is gone) | add Sentry / bring-your-own, or skip |
| **Portable exe** | Tauri has no single-file portable target | ship zipped `*-release/` folder, or accept NSIS-only |
| **WebView variance** | WebKitGTK ≠ WebView2 for advanced APIs | zonevert uses none today; re-audit if Canvas/WebGL/WebRTC added |
| **`image:thumbnail` via ffmpeg** | a second ffmpeg process per thumbnail (slight latency vs nativeImage) | batch, or switch to the `image` crate if AVIF/HEIC aren't needed |
| **Notification permission prompt** | first `showNotification` may prompt (Electron didn't) | `bindings.ts` handles it; UX note in README |
| **`platform` async** | store caches it on init; components read cached `$state` field | verified in Phase 3; `onMount` in `App.svelte` awaits `appState.init()` before first render needs it |
| **Logic tests vs `.ts`** | tests `require("./conversion-plan")` but file is now `.ts` | add `tsx` as loader, or keep `.js` barrel re-exporting from `.ts` |

## Rollback

The Electron app is untouched until Phase 7. At any point before then:

- `git checkout` the pre-Tauri commit → Electron app runs as v0.1.0.
- Rollback reverts `src-tauri/`, the Svelte frontend (`src/lib/`), `vite.config.ts`,
  `svelte.config.js`, `tsconfig.json`, and `package.json` scripts — the old
  `src/renderer.js` / `src/main.js` / `src/index.html` are still present (deleted
  only in Phase 7), so the Electron app boots immediately.

→ Back to [README.md](./README.md).
