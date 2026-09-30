# Zonevert — Upgrade Plan (Sept 2026)

Verdict: upgrade, don't rewrite. Order: correctness/security → toolchain → frontend → release.

---

## Phase 0 — Verify baseline (1–2 days)

- [ ] Record exact versions in `pnpm-lock.yaml`: `@tauri-apps/api`, `plugin-dialog`, `plugin-notification`, Vite, Svelte, TypeScript, tsx/Vitest, Playwright
- [ ] Record `src-tauri/Cargo.toml` + `Cargo.lock`: edition, tauri/tauri-build/tokio versions
- [ ] Check `tauri.conf.json`: `bundle.createUpdaterArtifacts`, `useHttpsScheme`, CSP, updater config
- [ ] Check `capabilities/default.json` — minimal or broad?
- [ ] Confirm `.github/workflows/release.yml` exists (README references it; tree snapshot may be stale)
- [ ] Check src: does history use localStorage / IndexedDB / filesystem?
- [ ] Check `src/lib/assets/bindings.ts` — generated or hand-maintained?
- [ ] Baseline runs green: `pnpm check`, `pnpm typecheck`, `cargo check`, `cargo test`, `pnpm install --frozen-lockfile`

## Phase 1 — FFmpeg runner correctness (3–5 days) ← top priority

- [ ] No `stdout()/stderr()` + `wait()` pattern anywhere — replace with one `tokio::select!` loop that drains stderr AND awaits exit
- [ ] Spawn with explicit `Stdio::piped()` only for needed streams
- [ ] Graceful cancel: write `q\n` to stdin → wait ~5s → escalate to `kill()` → `await` child (avoid zombie)
- [ ] `kill_on_drop(true)` as safety net only (SIGKILL-only, never the UX path)
- [ ] Parse progress: `frame= fps= size= time= bitrate= speed=` + optional `elapsed=HH:MM:SS.CC` (Apr 2025 patch — must parse with and without it)
- [ ] Test: fake FFmpeg writing >64KB to stderr then blocks — no deadlock
- [ ] Tests: custom path > `FFMPEG_PATH` > `PATH`, missing binary, missing encoder
- [ ] Never hold `MutexGuard` across `.await` near spawn/wait paths

## Phase 2 — State / queue / concurrency (3–4 days)

- [ ] `std::sync::Mutex` for plain queue/history data; drop async mutex unless I/O held across await
- [ ] `spawn_blocking` for path resolution, file size, filesystem enumeration
- [ ] Consider worker task per conversion that owns the child, sends progress/completion via channel
- [ ] Extend `queue-state.test.ts`: cancel while queued, cancel while running, retry, failure, thumbnail concurrency cap, progress event ordering
- [ ] No progress events after terminal state or app drop

## Phase 3 — Capability / scope / IPC hardening (2–4 days)

- [ ] Rewrite `capabilities/default.json` into small explicit files: core / dialog / notification (auto-enable = broad attack surface)
- [ ] Reference every required plugin permission explicitly; deny supersedes allow where needed
- [ ] Rust-side path validation for every command: normalize, reject traversal, prevent input==output collision
- [ ] Recheck IPC channel usage against 2.12 per-webview payload scoping / origin-scoped ACL denials
- [ ] Verify history survives `http://tauri.localhost` production-origin + `useHttpsScheme` change
- [ ] Regenerate `gen/schemas` after permission changes — never hand-edit

## Phase 4 — Toolchain alignment (3–5 days) ← decide before doing

- [ ] Decision: Tauri core **2.12.0** (Rust 1.90, edition 2024, Win7 dropped, released Sep 26 2026) vs. pinned pre-2.12 line
- [ ] If 2.12: move edition 2024, CI Rust ≥1.90, `cargo update` tauri/tray/muda/objc2, fix errors
- [ ] README Rust requirement: ≥1.77.2 → real target
- [ ] JS: `@tauri-apps/api` → 2.11.1 + matching plugins; verify pairing with chosen Rust core
- [ ] CI matrix: Linux (assert `webkit2gtk-4.1` + `libgtk-3`), Windows (WebView2), macOS

## Phase 5 — Frontend modernization (4–6 days)

- [ ] Grep + fix legacy Svelte: `on:` modifiers, `createEventDispatcher`, duplicate event attrs, `$:` reactivity
- [ ] Runes-first: `$state`, `$derived` as declarations/functions, `$effect` only for external side effects, callback props, actions for capture/passive
- [ ] Stores only where genuinely global
- [ ] Generate `bindings.ts` from Rust commands (Specta optional — do **not** copy AGPL template code)
- [ ] UI tests: queue table, progress title, error toasts, dialog/notification failures, persistent history

## Phase 6 — Release / signing / licensing (4–7 days)

- [ ] Recreate/verify `.github/workflows/release.yml` + 3-platform artifact matrix
- [ ] macOS: Apple Developer ID + `TAURI_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`; notarize
- [ ] If updater: set `bundle.createUpdaterArtifacts: true` — else tauri-action repackages `.app`, invalidates `.sig` (issue #1260)
- [ ] Audit Windows code signing + Linux package metadata (README only documents macOS)
- [ ] Keep system-FFmpeg default. If sidecar: LGPL-only, notices + source offer, order custom > bundled > `PATH`, no libx264/x265/fdk-aac (GPL)
- [ ] `pnpm install --frozen-lockfile` in CI; review every `onlyBuiltDependencies` entry

## Phase 7 — Optional (1–2 weeks)

- [ ] FFmpeg version/encoder probe at startup → precise "avif unavailable in your build" errors
- [ ] Metadata policy: preserve ICC/orientation default; document that re-encode destroys C2PA provenance
- [ ] image2 `atomic_writing` for single-image outputs
- [ ] Replace deprecated `-vsync cfr` usage after FFmpeg-build verification
- [ ] Better quality hints per codec (JXL effort/distance/modular/xyb if added)
- [ ] No `strict=experimental` for user input without opt-in

---

## Guardrails

- Don't chase FFmpeg master features; build a compat layer: probe version → branch command construction
- Test FFmpeg matrix: 7.1.x, 8.x (major breaking changes: vf_scale2ref removed, TLS cert verification, NVENC <11.1 dropped)
- Capabilities ≠ security. Rust argument validation is still mandatory
- Do not bundle GPL FFmpeg without accepting whole-app GPL obligations
- Keep `Cargo.lock` + `pnpm-lock.yaml` committed
