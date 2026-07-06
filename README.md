# Zonevert

Zonevert is a cross-platform (Windows, Linux, macOS) desktop UI for batch image conversion through FFmpeg.

## Requirements

- Node.js and pnpm
- Rust toolchain (stable ≥ 1.77.2)
- System WebView: WebView2 on Windows, `webkit2gtk-4.1` + `libgtk-3` on Linux
- FFmpeg — **bundled automatically** (see FFmpeg below). A custom FFmpeg path
  can still be entered in the app's Advanced panel, or set via the `FFMPEG_PATH`
  env var.

> macOS build host needs the Rust targets `aarch64-apple-darwin` and
> `x86_64-apple-darwin` (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

## Run

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the Vite dev server (HMR) and launches the Tauri window.
On first run it downloads the bundled FFmpeg sidecar for your platform (see
FFmpeg below).

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
The bundled FFmpeg sidecar is fetched and checksum-verified during packaging
— no manual FFmpeg setup needed.

### macOS signing & notarization

The macOS `.dmg` is built **unsigned**. Users can still run it by
right-clicking → Open (or System Settings → Privacy & Security → "Open
Anyway"), but Gatekeeper blocks it by default and auto-update requires
signing. To ship a zero-friction Mac build, provide an Apple Developer ID
certificate and set the CI secrets `TAURI_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD`, and `APPLE_TEAM_ID`; `tauri build` then notarizes
automatically.

## FFmpeg

FFmpeg is bundled as a Tauri [external binary](https://v2.tauri.app/develop/sidecar/)
(sidecar) and shipped inside each installer, so **no system FFmpeg is required**.
Resolution order when the app runs a conversion:

1. Custom path from the Advanced panel (if set)
2. `FFMPEG_PATH` environment variable
3. Bundled sidecar
4. `ffmpeg` on `PATH`

The sidecar binaries are downloaded by `scripts/fetch-ffmpeg.mjs` (run
automatically via the `predev` / `prepackage:*` npm hooks) and are
**pinned to a specific version with a verified SHA-256** — a changed or
mismatched download fails the build. Current pins:

| Platform | Source | Version | Triple |
|----------|--------|---------|--------|
| Linux   | johnvansickle.com | 6.0.1 static | `x86_64-unknown-linux-gnu` |
| Windows | BtbN/FFmpeg-Builds (`latest`) | win64 gpl-shared | `x86_64-pc-windows-msvc` |
| macOS (Apple Silicon) | johnvansickle.com | 6.0.1 static | `aarch64-apple-darwin` |
| macOS (Intel) | johnvansickle.com | 6.0.1 static | `x86_64-apple-darwin` |

The binaries live in `src-tauri/binaries/` and are git-ignored (fetched on
demand). Bump the URL + SHA-256 in the script when you intentionally want a
newer FFmpeg.

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

Zonevert bundles [FFmpeg](https://ffmpeg.org/) as a sidecar. FFmpeg is
licensed under the GNU LGPL/GPL — see its source for details. The bundled
binaries are not built by this project; they are downloaded from third-party
static builds:

- **Linux & macOS**: static builds by John VanSickle
  ([johnvansickle.com/ffmpeg](https://johnvansickle.com/ffmpeg/)),
  licensed under the GNU GPL.
- **Windows**: builds from BtbN's
  [FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) (GPL shared),
  licensed under the GNU GPL.

These binaries are fetched and SHA-256 verified by `scripts/fetch-ffmpeg.mjs`
(pinned versions, see the FFmpeg section above). If you redistribute Zonevert,
ensure compliance with FFmpeg's license terms for the bundled binaries.

### FFmpeg source offer

Per the FFmpeg license, the corresponding source for the bundled binaries is
available here:

- FFmpeg (all platforms): <https://ffmpeg.org/download.html> — source for the
  6.0.1 release used by the Linux/macOS builds, and the current release used by
  the Windows build.
- Linux & macOS static builds: <https://johnvansickle.com/ffmpeg/> (build
  configuration and source references for the 6.0.1 static builds).
- Windows builds: <https://github.com/BtbN/FFmpeg-Builds> (build scripts and
  source for the `gpl-shared` artifacts).

Zonevert itself is released under the MIT License; the bundled FFmpeg binaries
are covered by the GNU GPL/LGPL as noted above.
