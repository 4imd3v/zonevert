# Video Conversion Support — Plan & Progress

Goal: extend Zonevert from image-only to image + single-file video conversion,
reusing the existing Tauri/Rust FFmpeg subprocess architecture. No rewrite, no
new runtime deps, no bundled FFmpeg sidecar (deferred to Phase 6 decision).

Governing decisions (from research + repo audit):

- Keep **system FFmpeg** model; add **FFprobe** as a first-class runtime dep
  (sibling inference from a custom FFmpeg path + `FFPROBE_PATH` env override).
- Native subprocess stays the engine: FFprobe → plan argv → spawn → parse
  stderr progress → temp output → atomic rename on success.
- Video logic lives in **pure, tested TS logic modules** + Rust; nothing in
  `.svelte` files. (Repo convention since Phase 0.)
- Desktop only. Mobile (Tauri shell can't spawn arbitrary processes) gets
  video UI hidden.
- No WASM (47–245× sandbox slowdown), no in-process libav yet, no HLS/concat/
  subtitles/filter-graph builder in the first video release.

## Phase 0 — Baseline audit — DONE

Recorded facts (from code reading):

- FFmpeg invoked via `tokio::process::Command` in `src-tauri/src/ffmpeg.rs`
  (no Tauri shell plugin, no sidecar; ACL unchanged by video work).
- `probe_image` runs **ffmpeg** (`-select_streams v:0 -show_entries
  stream=width,height -of csv=p=0`); ffprobe is never resolved as its own
  binary. `FFMPEG_PATH` override exists; no `FFPROBE_PATH`.
- Output is written **directly** to the final path — no temp + atomic rename
  today.
- Queue: `runPool` concurrency 1..8; statuses pending/running/done/failed/
  canceled/skipped; progress = parse of `frame=/fps=/time=/size=/elapsed=`.
- Cancel: Notify-based, SIGTERM → 5s → SIGKILL escalation, registry entry
  removed before reader joins (signal-safe; temp cleanup NOT handled).
- Encoder preflight: `ffmpeg -encoders` name list + `missingEncoderWarning()`
  in conversion-plan.ts (image formats only).
- Tests: node:test+tsx for `tests/*.test.ts`, vitest for `tests/store/**`.
  `pnpm check` = svelte-check && tsx tests && vitest (needs `CI=true`).
  cargo test 17/17 green.

## Phase 1 — FFprobe resolution + media inspection — DONE

Goal: the app can inspect any input (video/audio/image) and report a typed
media summary. Frontend can classify "is this real video?" before queueing.

- Rust: `resolve_ffprobe()` (explicit → sibling of ffmpeg path → `FFPROBE_PATH`
  → `ffprobe`); `probe_media()` command returning duration + first real
  (non-`attached_pic`) video stream + first audio stream + typed error.
- TS: `probeMedia()` binding + `media-probe.ts` pure logic
  (`classifyMedia`, `isConvertibleVideo`, `formatProbeSummary`,
  `formatDuration`).
- Tests: Rust (resolve + JSON parse incl. cover-art/no-audio/duration-less
  PNG, real ffprobe run on a generated clip), TS (classification + formatting).
- Validate: `cargo test`, `CI=true pnpm check`.
- Exit: cover-art mp3 is NOT video; no-audio mp4 IS convertible video;
  missing ffprobe returns a typed error, not a crash.

## Phase 2 — Video conversion planning (pure logic) — DONE

Goal: `video-plan.ts` builds a tested argv from (probe summary × profile).

- Profiles v1: `mp4-h264` (libx264, yuv420p, aac, faststart), `webm-vp9`
  (libvpx-vp9, libopus), `mp4-hevc` (advanced, libx265).
- Controls: resolution (source/1080/720/480 → `scale=-2:H`), fps
  (source/24/30/60), quality (crf per encoder), encoder pref (auto/cpu).
- Optional stream map `0:a:0?`; remux-only (`-c copy`) when probe says
  container+codecs already match and no scaling/fps change.
- Rejections: no real video stream (cover art/audio), same in/out path,
  unknown duration warning (indeterminate progress), unsupported encoder
  (reuse Phase 7 encoder list).
- Tests: argv for every profile, no-audio, attached-pic rejection, remux
  detection, scaling math, crf mapping.

## Phase 3 — Video-aware queue, progress, atomic output — DONE

Goal: long jobs are safe and honest.

- QueueItem gains `duration` (from probe) + percent progress +
  `finalizing` status; `statusLabel`/summarize updated; progress parser gains
  `speed=`/`parseTimecodeSeconds()`; ETA from remaining/speed.
- Rust: `convert` gains atomic-output mode — write to
  `<out>.zonevert-tmp-<jobid>` in the same dir, rename on success, unlink on
  failure/cancel; cancel path unlinks temp file after reaping.
- Store: percent shown when duration known, indeterminate otherwise;
  throttled progress events (already chunked by stderr reads; cap UI updates
  via existing 500-line log guard pattern — reuse applyProgress guard).
- Tests: timecode→seconds, percent clamps, finalizing summary counts,
  rename/cleanup Rust integration test with fake ffmpeg.

## Phase 4 — Video intake & UI — DONE

Goal: users can add, inspect, configure, and convert videos.

- SourcePanel: accept video extensions in dialog + drag-drop; show probe
  summary (codec · WxH · duration · audio) per file; keep images working.
- New VideoPanel (or Profile section in OutputPanel): profile selector,
  resolution/fps/quality, remux hint, encoder warning.
- QueuePanel: percent progress bar per item, speed/ETA text.
- Mobile-safe: hide video UI when `platform()` is iOS/Android build (capability
  is desktop today — gate on `cfg(desktop)` if needed).
- Tests: store-level vitest flows for video queue (probe → plan → run).

## Phase 5 — Hardware encoders & preflight

Goal: use NVENC/QSV/AMF/VideoToolbox/VAAPI when present, CPU fallback else.

- Extend `probe_encoders` parse (already list-based): video encoder table
  (libx264/libx265/libvpx-vp9/h264_*/hevc_*).
- Vendor-aware quality mapping: `-crf` (libx264/libvpx-vp9), `-cq` (nvenc),
  `-global_quality` (qsv), `-qp` (vaapi), vendor flags (amf/videotoolbox).
- 1-second validation encode probe (lavfi color → null muxer) before first
  use of a hardware encoder; fallback to CPU + non-blocking warning.
- Tests: mapping table pure fn; fallback selection; "VP9 + nvenc unsupported"
  resolves to libvpx-vp9.

## Phase 6 — Docs, packaging, release

Goal: ship honestly.

- README: FFprobe requirement, `FFPROBE_PATH`, supported profiles/containers,
  troubleshooting matrix (no ffprobe / no libx264 / old ffmpeg).
- Keep system-FFmpeg release (no size/licensing change). Record sidecar
  decision for later: `externalBin` + target triples ≈ +100–191MB/platform,
  GPL redistribution obligations — only if zero-install demand is proven.
- Changelog entry; bump 0.6.0 when phases 1–5 land.

## Non-goals for first video release

Concat/join · HLS/DASH segmentation · subtitle burn-in · multi-track remux ·
filter-graph builder · GIF-from-video · AV1 · upscaling · bundled FFmpeg ·
WASM fallback · mobile conversion · audio extraction (m4a/mp3) — revisit
after core video is stable.
