# Zonevert

Zonevert is a cross-platform (Windows, Linux, macOS) desktop UI for batch
image and video conversion through FFmpeg.

## Requirements

- Node.js and pnpm
- Rust toolchain (stable ≥ 1.90, per Tauri 2.12's MSRV)
- System WebView: WebView2 on Windows, `webkit2gtk-4.1` + `libgtk-3` on Linux
- **FFmpeg installed on your system** (see [FFmpeg](#ffmpeg) below). A custom
  FFmpeg path can be entered in the app's Advanced panel, or set via the
  `FFMPEG_PATH` env var.
- **FFprobe** (ships with every FFmpeg install) is required for video
  conversion — it inspects inputs before planning. Zonevert resolves it as a
  sibling of your FFmpeg binary (e.g. `/opt/ffmpeg/bin/ffprobe` for
  `/opt/ffmpeg/bin/ffmpeg`), then falls back to the `FFPROBE_PATH` env var,
  then `ffprobe` on `PATH`.

> macOS build host needs the Rust targets `aarch64-apple-darwin` and
> `x86_64-apple-darwin` (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

## Run

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the Vite dev server (HMR) and launches the Tauri
window. FFmpeg must already be on your `PATH` (or set `FFMPEG_PATH`).

For frontend-only development without the native window:

```bash
pnpm dev
```

## Type checking & tests

```bash
pnpm check      # svelte-check + logic tests (tsx loader)
pnpm typecheck  # svelte-check only
```

`svelte-check` type-checks all `.svelte` and `.ts` files. Logic tests run the
pure-logic modules (`src/lib/logic/*.ts`) via `tsx`.

## Package

Build on the target operating system when possible:

```bash
pnpm run package:linux    # .deb + .AppImage
pnpm run package:windows  # NSIS + MSI installers
pnpm run package:macos     # .dmg (Apple Silicon native)
```

Linux packaging outputs `.deb` and `.AppImage`. Windows packaging outputs NSIS
and MSI installers. macOS packaging outputs a `.dmg` (built natively on an
Apple Silicon runner). Cross-building Windows installers from Linux requires
Wine. Generated package output is ignored by Git. To remove local build
artifacts:

```bash
pnpm run clean
```

### CI release builds

`.github/workflows/release.yml` builds all three platforms on tag push
(`v*`) or manual dispatch, and attaches the artifacts to a GitHub Release.
No FFmpeg is needed at build time — the app shells out to the user's system
`ffmpeg` at runtime.

### macOS signing & notarization

By default the macOS `.dmg` is built **unsigned**. Users can still run it by
right-clicking → Open (or System Settings → Privacy & Security → "Open
Anyway"), but Gatekeeper blocks it by default. To ship signed + notarized
builds, set these repository secrets/variables — the workflow detects them
and falls back to unsigned when they are absent:

| Name | Kind | Purpose |
| --- | --- | --- |
| `APPLE_CERTIFICATE` | secret | base64 `.p12` Developer ID certificate |
| `APPLE_CERTIFICATE_PASSWORD` | secret | password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | variable | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | secret | Apple ID used by `notarytool` |
| `APPLE_PASSWORD` | secret | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | secret | Apple Developer team ID |

### Windows signing

Set `WINDOWS_CERTIFICATE` (secret, base64 `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD` (secret); `tauri build` picks them up and
signs the NSIS/MSI bundles. Without them the installers are unsigned
(SmartScreen warning on first run).

### Updater

No auto-updater is wired up. Enabling one requires four pieces that do not
exist yet — decide deliberately rather than flip a flag:
`tauri-plugin-updater`, a minisign keypair + signing key in CI secrets, a
hosted `latest.json` endpoint (HTTPS), and
`bundle.createUpdaterArtifacts: true` in `tauri.conf.json`. Without that
last flag some CI actions repackage the `.app` and invalidate the updater
signature (tauri-apps/tauri-action#1260).

## FFmpeg

Zonevert requires FFmpeg on your system. Resolution order when the app runs a
conversion:

1. Custom path from the Advanced panel (if set)
2. `FFMPEG_PATH` environment variable
3. `ffmpeg` on `PATH`

Install FFmpeg through your package manager or download from
[ffmpeg.org](https://ffmpeg.org/download.html).
### Encoder availability

The app probes `ffmpeg -encoders` at startup and warns when your build lacks
an optional encoder for the selected format (the default, **webp**, needs
`libwebp`; `avif` needs `libaom-av1` or `libsvtav1`; `jp2` needs
`libopenjpeg` — commonly missing from minimal distro builds). All other
supported formats use codecs built into every FFmpeg build.

### Metadata & provenance
Unchecking "Keep metadata" passes `-map_metadata -1`, which strips metadata
from the output. Note that any conversion is a re-encode: C2PA content
credentials are **destroyed by re-encoding** even for "clean" files, so
converted outputs carry no provenance from the source.

### Supported output formats

`webp`, `jpg`, `png`, `avif`, `tiff`, `bmp`, `gif`, `apng`, `jp2` (JPEG 2000),
`jls` (JPEG-LS), `exr` (OpenEXR), `qoi`, `tga` (Targa).

**Input** accepts any format your FFmpeg build can decode, including
`heic`/`heif` (import-only — Zonevert can read HEIC but cannot encode it).

Notable gaps in typical distro FFmpeg builds: **JPEG XL (jxl)** and
**HEIF encoding** — both require a custom FFmpeg build if needed.

## Video conversion

Videos are inspected with FFprobe before conversion, and videos and images
can be mixed in one queue — each file is planned with its own profile.

### Profiles (Video tab)

| Profile | Container | Video | Audio | Notes |
| --- | --- | --- | --- | --- |
| MP4 · H.264 | `.mp4` | H.264, yuv420p | AAC | Safest default; plays everywhere |
| WebM · VP9 | `.webm` | VP9 | Opus | Good for web playback; slower encode |
| MP4 · HEVC | `.mp4` | HEVC, yuv420p, hvc1 tag | AAC | Smaller files; less universal playback |
| GIF (animated) | `.gif` | GIF | — | Animated image; palette-based, no audio |
| WebP (animated) | `.webp` | WebP | — | Animated image; loops forever, no audio |

Controls: resolution (source / 1080p / 720p / 480p, `scale=-2:H`), frame rate
(source / 24 / 30 / 60), and a CRF quality slider (0–51, or 0–63 for VP9;
lower = better quality, larger files). Zonevert warns before running when the
source is already an efficient codec (H.264 / HEVC / VP9 / AV1) and the chosen
quality is loose — re-encoding then often produces a larger file than the
source. The Video tab and each queue row also show an approximate output
size: for re-encodes a 3-second sample of the actual file is encoded through
the real pipeline and extrapolated (exact for remuxes), so the number responds
to profile, quality, resolution and frame rate.

### Animated images

Both animated-image outputs drop audio (GIF and WebP cannot carry it), and GIF
uses the `palettegen`/`paletteuse` filter chain so colors survive — without it,
GIF output is dithered garbage. GIF caps source input at 12 fps / 480 px wide
(GIFs explode past that) unless you pick a different resolution or frame rate;
the quality slider then controls palette dithering. Animated WebP maps the
slider onto WebP's 0–100 quality scale and loops forever (`-loop 0`). Both
formats are far less efficient than their video sources — expect large
outputs, and Zonevert says so before the queue runs.

### Remuxing

When the input already matches the chosen profile (e.g. H.264 + AAC into
MP4) and no scaling or frame-rate change is requested, Zonevert remuxes with
`-c copy` — a fast, lossless container rewrite instead of a re-encode.

### Hardware encoders

The Video tab lists the hardware encoders your FFmpeg build provides for the
selected profile. Each one must pass a 1-second test encode before use —
driver problems often hide behind `ffmpeg -encoders` output — and on failure
the job runs on the CPU encoder with a visible note. Quality flags are mapped
per vendor (`-crf` libx264/libx265/libvpx-vp9, `-cq` NVENC, `-global_quality`
QSV, `-qp` VAAPI, CQP AMF, `-q:v` VideoToolbox); the same CRF slider drives
them all. VP9 currently encodes on the CPU only (vendor VP9 support is
uneven). Choose "CPU only" to pin the software encoders.

### Safety & progress

Outputs are written to a temporary file next to the destination and renamed
only after a successful encode, so a failed or cancelled job never leaves a
half-written file behind. Progress is percentage-based (FFprobe duration ×
FFmpeg `time=`) with speed and ETA; files with unknown duration show an
indeterminate bar. Cancellation sends SIGTERM (FFmpeg finalizes the current
output) and escalates to SIGKILL if the process ignores it.

### Accepted video inputs

`mp4`, `m4v`, `mov`, `mkv`, `webm`, `avi`, `flv`, `wmv`, `ts`, `m2ts`,
`mpeg`, `mpg`, `3gp`, `ogv` — anything your FFmpeg build can demux.
Audio-only files (including ones that only carry cover art) are detected
with FFprobe and kept out of video conversion.

### Known limits

No concat/join, HLS/DASH output, subtitle burn-in, or multi-track remuxing —
deliberately deferred until the core path is battle-tested. Video conversion
is desktop-only; Tauri mobile builds cannot spawn FFmpeg.

## Architecture

Tauri 2 backend (Rust, `src-tauri/`) + Svelte 5 + TypeScript + Vite frontend
(`src/`). The backend spawns ffmpeg/ffprobe directly via
`tokio::process::Command` and emits `ffmpeg:log` events; the frontend calls
typed bindings in `src/lib/bindings.ts`.

The renderer adapts UI state into a conversion intent, while
`src/lib/logic/conversion-plan.ts` (images) and
`src/lib/logic/video-plan.ts` (videos) build FFmpeg arguments,
`src/lib/logic/media-probe.ts` classifies probed media, and
`src/lib/logic/queue-state.ts` owns queue lifecycle status transitions. These
modules are covered by `pnpm check`.

## FFmpeg Scope

The main controls cover common image conversion needs: format, quality,
overwrite behavior, metadata, resize mode, and batch queue execution — plus
video profiles (H.264/VP9/HEVC), resolution, frame rate, and encoder choice
for videos in the queue. The Advanced FFmpeg section exposes global, input,
filter graph, and output arguments so FFmpeg options can be used without
changing the UI code.

## Acknowledgements

[FFmpeg](https://ffmpeg.org/) is a separate project licensed under the GNU
LGPL/GPL. Zonevert does not distribute FFmpeg — users install it themselves.
Zonevert itself is released under the MIT License.
