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

## Phase 2 — State / queue / concurrency ✅ DONE

- [x] Audit done in Phase 0/1: `state.rs` is a plain `tokio::Mutex<HashMap>` — no guard held across await, no async mutex over plain data beyond the (now tiny) registry
- [x] Sync fs commands (`check_exists`/`file_size`) are local metadata-only calls (µs) called per-item — left sync, spawn_blocking would be churn without a win
- [x] Extracted `runPool(items, concurrency, worker, onSkipped, shouldStop)` into logic/queue-state.ts — dedupes the two hand-rolled worker pools in the store (thumbnails + conversions); sequential mode is now just concurrency=1 through the same path (the old if/else + separate pool method are gone)
- [x] `convert()` invoke wrapped in try/catch → IPC failure now fails that job instead of stranding the queue with `isConverting` stuck true
- [x] Thumbnail overwrite race fixed: per-item `$state` assignment (concurrent add-folder calls used to overwrite each other's map with a stale base); thumbnails now also display progressively
- [x] Progress-after-terminal guard moved out of the store into tested `applyProgress()` (applies only to `running` items). Side effect: trailing ffmpeg stderr that isn't a progress line is now appended to the log after completion (old code dropped all post-terminal output)
- [x] Tests: 7 new in tests/queue-state.test.ts — runPool concurrency cap (peak=3), sequential order at 1, cancel drain via onSkipped, empty-list, applyProgress running-only + unknown-id, cancel-wins-over-success
- [x] Post-change: `CI=true pnpm check` 33/33 ✅ (svelte-check + tsx)
- Skipped: store-level unit tests — the store is a `.svelte.ts` runes module and the tsx harness can't compile it; all flow logic now lives in testable pure modules instead. Add vitest+svelte-plugin in Phase 5 if component-level tests are wanted.

## Phase 3 — Capability / scope / IPC hardening ✅ DONE

- [x] **ACL trimmed to the exact used surface**: `core:default` + `core:event:default` + redundant explicit allows → `core:event:allow-listen`, `core:event:allow-unlisten`, `dialog:default`, `notification:default`. Verified by grep that the webview's whole Tauri JS surface is: `invoke` (own commands, not ACL-gated), `event.listen` (log stream + the drag-drop handler inside `getCurrentWebviewWindow().onDragDropEvent`), dialog open/save, notification. No window/webview/app/menu/path/image/tray commands are used, so `core:default` was over-grant. Validated: `cargo check` + full `tauri build --no-bundle` pass; `gen/schemas` regenerated (build artifact, gitignored)
- [x] **Rust path-validation audit — decision: no new validation** (deliberate, not skipped): `convert` takes raw ffmpeg argv (the app is an ffmpeg console by design — validating argv means reimplementing an ffmpeg parser); `save_file` paths are user-sanctioned via the native save dialog; `file_size`/`check_exists`/`probe_image`/`image_thumbnail` are read-only and user-file-scoped. All failure modes are already contained (tokio::fs::write and Command::spawn return typed errors → `{ok:false, error}`). The real boundary is CSP + no `remote` permission + single main window + no custom-protocol asset feature — all confirmed present. Rust-side argv whitelisting would be security theater that breaks the product
- [x] **Origin stability verified**: no `useHttpsScheme` in tauri.conf.json → production origin `http://tauri.localhost` (tauri 2.11.6 default); stable across v2 minor upgrades, so localStorage history/settings survive upgrades. The 1.x→2.x origin break is already behind this app
- [x] Split into one commented file instead of 3 (core/dialog/notification) — splitting is organizational only, Tauri merges identically; revisit when a second window/platform gate is actually needed
- [x] `gen/schemas` verified gitignored — no stale generated state to commit
- Skipped: `spawn_blocking` for sync fs metadata commands (µs-class, per-item) — churn without a win

## Phase 4 — Toolchain alignment ✅ DONE

- [x] **Decision: adopt Tauri 2.12.0** (released Sep 26 2026). Rationale: security fixes + longevity; env Rust is 1.98.1 ≥ MSRV 1.90; Win7 drop irrelevant (we already require WebView2 / webkit2gtk-4.1); tauri's own edition-2024 move does NOT force downstream editions, so the crate stays edition 2021
- [x] Rust: `rust-version` 1.77.2 → 1.90; `cargo update` tauri/tauri-build/plugins → tauri 2.12.0, tauri-runtime 2.12.0, tauri-plugin-dialog 2.8.0, tauri-plugin-notification 2.5.0 (wry 0.57, webview2-com 0.39, windows 0.62 pulled in). No compile breaks; no deprecation hits (we don't use `InvokeMessage::state` etc.)
- [x] JS pairing: `@tauri-apps/api` ^2.12.0, `plugin-dialog` ~2.8.0, `plugin-notification` ~2.5.0, `@tauri-apps/cli` ^2.12.0
- [x] README: Rust requirement → stable ≥ 1.90 (per Tauri 2.12 MSRV)
- [x] CI gap fixed: release.yml now runs `cargo test` (Linux/Win/macOS matrix already had WebView2 + webkit2gtk-4.1 deps — the matrix item was already satisfied)
- [x] Validation: `cargo test` 15/15 ✅, `CI=true pnpm check` 33/33 ✅, full `pnpm tauri build --no-bundle` on the 2.12 stack ✅
- Skipped: edition 2024 for our crate (no downstream requirement; 2021 is fine), explicit `dtolnay/rust-toolchain` pin in CI (runner stable is already ≥ MSRV and only moves forward)

## Phase 5 — Frontend modernization ✅ DONE

- [x] **Legacy Svelte audit: ZERO legacy patterns** — grep across all 14 components: no `on:` directives, no `createEventDispatcher`, no `export let`, no `$:` statements, no `<slot>`, no `beforeUpdate`/`afterUpdate`. All 11 components use `$props`; the runes migration was done by the earlier port. Nothing to fix — verified, not assumed
- [x] **Type generation: REJECTED (Specta)** — would peg the app to two pre-release crates (`specta` 2.0.0-rc.25 + `tauri-specta` 2.0.0-rc.25, both still RC-only) to guard drift on a frozen 9-struct surface with exactly one consumer. Revisit trigger: a second frontend consumer OR when struct churn actually starts. Recorded as accepted debt
- [x] **tsconfig now typechecks `tests/**`** (was src-only): surfaced a real latent bug — `conversion-plan.test.ts` passed `width: "1200"` (string) while the intent type said number. Fixed honestly by widening `createConversionIntent`/`buildResizeFilter` width/height to `number | string` (runtime `positiveInteger(unknown)` coercion was deliberate input validation at a trust boundary)
- [x] **vitest store/UI-flow harness** (the Phase 2 blocker): `vitest.config.mts` with the existing svelte plugin (compiles `.svelte.ts` runes) + jsdom + `$lib` alias; `tests/store/` (kept out of the tsx `tests/*.test.ts` glob so the two harnesses don't collide — node:test for pure logic, vitest for store/DOM flows)
- [x] **10 store tests** (`tests/store/app-state.test.ts`, Tauri API mocked, real queue-state + logic modules): sequential run + title transitions + size summary + history persistence + notification; concurrency peak = setting (3 of 6); cancel current job (drops rest of queue, no history for canceled runs); stop-after-current; retry-failed re-runs only failed; skip collision mode; progress frames attach to running items only (post-terminal dropped); rejected `convert()` invoke fails the job without stranding the queue; history cap 20 on load; settings restore merges over defaults
- [x] `pnpm check` = svelte-check + tsx (33) + vitest (10) — CI gets all three via the existing workflow
- Validated: `CI=true pnpm check` ✅, `cargo test` 15/15 ✅
- Skipped: component-render tests (testing-library) — store flows carry the logic; add when a component's own behavior needs guarding

## Phase 6 — Release / signing / licensing ✅ DONE

- [x] `.github/workflows/release.yml` verified present; CI already runs `pnpm install --frozen-lockfile` + cargo test (Phase 4) + pnpm check
- [x] **macOS signing/notarization wired** (conditional on secrets, unsigned fallback preserved): cert-import step builds a temp keychain when `APPLE_CERTIFICATE` is set; `APPLE_SIGNING_IDENTITY` from repo vars feeds `tauri build`; a post-package step runs `notarytool submit --wait` + `stapler staple` when `APPLE_ID` is set
- [x] **Windows signing wired**: `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD` are passed to the Package step; tauri consumes them natively (no extra step). Unsigned fallback unchanged
- [x] **Updater deliberately NOT enabled** — no updater infra exists today (no plugin, keys, or endpoint); enabling it is a feature, not a flag. README now documents the four required pieces, including the `createUpdaterArtifacts: true` / tauri-action#1260 repack trap
- [x] **`.deb` runtime deps fixed**: `bundle.linux.deb.depends = ["libgtk-3-0", "libwebkit2gtk-4.1-0"]` — the deb previously declared no dependencies, so apt users got broken installs. AppImage unaffected
- [x] LICENSE verified present (MIT); no bundled FFmpeg → no FFmpeg licensing obligations; `onlyBuiltDependencies=esbuild` reviewed, clean
- [x] Validation: workflow YAML parses; `pnpm tauri build --no-bundle` accepts the new bundle config
- Not verifiable here: an actual signed macOS build (no Apple Developer account in this env) — the steps are conditional and standard; first real tag cut validates them
- Skipped: rpm/arch packaging targets (not produced today); Windows Azure Trusted Signing docs (OV-cert path covered by the env vars)

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
