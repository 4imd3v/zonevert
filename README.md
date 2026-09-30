# Zonevert

Zonevert is a cross-platform (Windows, Linux, macOS) desktop UI for batch image conversion through FFmpeg.

## Requirements

- Node.js and pnpm
- Rust toolchain (stable ≥ 1.90, per Tauri 2.12's MSRV)
- System WebView: WebView2 on Windows, `webkit2gtk-4.1` + `libgtk-3` on Linux
- **FFmpeg installed on your system** (see [FFmpeg](#ffmpeg) below). A custom
  FFmpeg path can be entered in the app's Advanced panel, or set via the
  `FFMPEG_PATH` env var.

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

## Architecture

Tauri 2 backend (Rust, `src-tauri/`) + Svelte 5 + TypeScript + Vite frontend
(`src/`). The backend spawns ffmpeg directly via `tokio::process::Command` and
emits `ffmpeg:log` events; the frontend calls typed bindings in
`src/lib/bindings.ts`.

The renderer adapts UI state into a conversion intent, while
`src/lib/logic/conversion-plan.ts` builds FFmpeg arguments and
`src/lib/logic/queue-state.ts` owns queue lifecycle status transitions. These
modules are covered by `pnpm check`.

## FFmpeg Scope

The main controls cover common image conversion needs: format, quality,
overwrite behavior, metadata, resize mode, and batch queue execution. The
Advanced FFmpeg section exposes global, input, filter graph, and output
arguments so FFmpeg options can be used without changing the UI code.

## Acknowledgements

[FFmpeg](https://ffmpeg.org/) is a separate project licensed under the GNU
LGPL/GPL. Zonevert does not distribute FFmpeg — users install it themselves.
Zonevert itself is released under the MIT License.
