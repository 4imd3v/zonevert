# Zonevert — Upgrade Plan (Sept 2026)

Verdict: upgrade, don't rewrite. Order: correctness/security → toolchain → frontend → release.

---

## Phase 0 — Verify baseline ✅ DONE (2026-09-28)

- [x] `pnpm-lock.yaml`: `@tauri-apps/api` ^2.11.1, `plugin-dialog` ~2.7.1, `plugin-notification` ~2.3.2→~2.3.3, Vite ^8.1.2, Svelte ^5.56.4, TS ^5.7, tsx ^4.22, no Playwright
- [x] Cargo: edition 2021, rust-version 1.77.2 (README says ≥1.77.2 — matches), tauri/tauri-build tokio w/ process features, kill-by-PID via nix/windows-sys
- [x] `tauri.conf.json`: no updater, no `createUpdaterArtifacts`; CSP `default-src 'self'` + img/style/script locked down; single main window
- [x] `capabilities/default.json`: single file, `windows:["main"]`, `core:default` + dialog/notification defaults + event listen/unlisten — already scoped to main window, no remote URLs
- [x] `.github/workflows/release.yml` exists (README matches tree)
- [x] History = localStorage (`HISTORY_KEY`), settings + theme also localStorage, all guarded try/catch
- [x] `bindings.ts` hand-maintained (mirrors Rust serde structs by hand — drift risk, Phase 5)
- [x] Baseline: `cargo test` 15/15 ✅, `CI=true pnpm check` 26/26 ✅ (env Rust 1.98.1 is ahead of declared 1.77.2)
- Note: `pnpm check` locally needs `CI=true` (pnpm 11 drift gate on out-of-sync node_modules) — CI itself is unaffected

## Phase 1 — FFmpeg runner correctness ✅ DONE

Verified in audit: drain model was already correct (concurrent reader tasks + `wait()` ≥ no pipe deadlock). Fixed the three real defects:

- [x] **PID-reuse window closed**: registry entry now removed immediately after `wait()` returns, *before* joining reader tasks (was: entry outlived the reaped child → late cancel could signal a recycled PID)
- [x] **Cancel = Notify, not kill-by-PID**: `ProcessRegistry` maps jobId → (pid, `Arc<Notify>`); `run()` owns the `Child` and the terminate sequence, so signals only ever reach its own live child
- [x] **Bounded escalation**: cancel → SIGTERM (ffmpeg's graceful 'q' equivalent) → 5s `GRACEFUL_EXIT` window → `Child::kill()` (SIGKILL) → `wait()` reaps. `cancel` command uses `notify_one` (permit survives unpolled `notified()` — no lost-wakeup)
- [x] Window-destroy cleanup unchanged: direct PID kill at shutdown (immediate, no graceful wait)
- [x] Bounded reader joins (`GRACEFUL_EXIT`): a straggler grandchild holding the pipe write-end past child death can no longer hang the job forever — `# ponytail:` comment marks the ceiling (process-group signal = upgrade path)
- [x] Refactor: `run<R: Runtime>(&AppHandle<R>)`, `resolve_ffmpeg`/`probe_image`/`thumbnail` no longer take unused AppHandle (testability + no dead param)
- [x] Tests (fake ffmpeg scripts, unix-gated, via `tauri::test::mock_app` + `tauri` dev-dep `test` feature + tokio `time` feature):
  - `run_drains_stderr_flood_without_deadlock` — 70KB stderr flood, asserts no deadlock + registry cleanup
  - `cancel_terminates_polite_process` — SIGTERM-able process, returns promptly `!ok`
  - `cancel_escalates_to_sigkill_when_sigterm_ignored` — trap-ignoring TERM, SIGKILL at 5s
  - `resolve_ffmpeg_env_priority` — merged 4 racy env tests into one sequential test (cargo runs tests in parallel; env mutation across threads is a race)
- [x] Post-change: `cargo test` 15/15 ✅, `CI=true pnpm check` 26/26 ✅, no warnings
- Skipped: structured progress events (frontend protocol works as-is; `elapsed=` parsing deferred to Phase 7). Add when the event contract is reworked anyway.

## Phase 2 — State / queue / concurrency

- [x] Audit done in Phase 0/1: `state.rs` is a plain `tokio::Mutex<HashMap>` — no guard held across await, no async mutex over plain data beyond the (now tiny) registry
- [ ] Confirm `spawn_blocking` or async fs for file enumeration in frontend-triggered paths (commands `check_exists`/`file_size` are sync `std::fs` — brief, acceptable; revisit only if large-dir enumeration moves to Rust)
- [ ] Extend `queue-state.test.ts`: cancel while queued/running, retry, failure, thumbnail concurrency cap, progress event ordering
- [ ] Verify no progress events after terminal state / app drop

## Phase 3 — Capability / scope / IPC hardening

- [x] Verified `capabilities/default.json` is smallest practical today: main-window-scoped, no `remote` permission, no fs scope permissions (custom protocol feature commented out in Cargo)
- [ ] Split into explicit files (core / dialog / notification) + `windows` targeting — cosmetic today; do before adding any new permission
- [ ] Rust path validation for every command taking a path (`save_file` writes arbitrary `file_path` from webview; `convert` args are raw ffmpeg argv). app accepts arbitrary user-selected files by design, but same-input/output collision + traversal rejection are cheap Rust-side wins
- [ ] Verify history survives `http://tauri.localhost` production-origin + `useHttpsScheme` across an upgrade (localStorage is origin-keyed)

## Phase 4 — Toolchain alignment

- [ ] Decision pending: Tauri core **2.12.0** (Rust 1.90, edition 2024, Win7 dropped, released Sep 26 2026) vs. pinned pre-2.12 line — env already runs Rust 1.98.1
- [ ] If 2.12: edition 2024, CI Rust ≥1.90, `cargo update` tauri/tray/muda/objc2
- [ ] README Rust requirement ≥1.77.2 → real target (only after decision)
- [ ] JS already on `@tauri-apps/api` ^2.11.1 + plugins — remainder is verifying pairing, not bumping
- [ ] CI matrix: Linux (`webkit2gtk-4.1` + `libgtk-3`), Windows (WebView2), macOS

## Phase 5 — Frontend modernization

- [ ] Grep + fix legacy Svelte: `on:` modifiers, `createEventDispatcher`, duplicate event attrs, `$:` reactivity
- [ ] Runes-first components; callback props; actions for capture/passive; stores only where global
- [ ] Replace hand-mirrored `bindings.ts` with generated types (Specta optional — do **not** copy AGPL template code)
- [ ] UI tests: queue table, progress title, error toasts, dialog/notification failures, persistent history

## Phase 6 — Release / signing / licensing

- [x] `.github/workflows/release.yml` verified present
- [ ] macOS: Apple Developer ID + `TAURI_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`; notarize (README says dmg is unsigned)
- [ ] If updater: set `bundle.createUpdaterArtifacts: true` — else tauri-action repackages `.app`, invalidates `.sig` (issue #1260)
- [ ] Audit Windows code signing + Linux package metadata
- [ ] Keep system-FFmpeg default. If sidecar: LGPL-only, notices + source offer, order custom > bundled > `PATH`, no GPL encoders
- [ ] `pnpm install --frozen-lockfile` in CI; review `onlyBuiltDependencies` (currently just `esbuild` — clean)

## Phase 7 — Optional

- [ ] FFmpeg version/encoder probe at startup → precise "avif unavailable in your build" errors
- [ ] Parse optional `elapsed=HH:MM:SS.CC` (wall clock) alongside `time=` (media time) in progress UI
- [ ] Metadata policy: preserve ICC/orientation default; document that re-encode destroys C2PA provenance
- [ ] image2 `atomic_writing` for single-image outputs
- [ ] Replace deprecated `-vsync cfr` usage after FFmpeg-build verification
- [ ] No `strict=experimental` for user input without opt-in

---

## Guardrails

- Don't chase FFmpeg master features; build a compat layer: probe version → branch command construction
- Test FFmpeg matrix: 7.1.x, 8.x (major breaking changes: vf_scale2ref removed, TLS cert verification, NVENC <11.1 dropped)
- Capabilities ≠ security. Rust argument validation is still mandatory
- Do not bundle GPL FFmpeg without accepting whole-app GPL obligations
- Keep `Cargo.lock` + `pnpm-lock.yaml` committed
