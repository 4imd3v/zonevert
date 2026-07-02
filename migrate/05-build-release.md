# 5. Build & Release

Replace `electron-builder` with `tauri build`. The bundler config moves from
`package.json#build` into `src-tauri/tauri.conf.json#bundle`. GitHub Actions
switches from the matrix+electron-builder flow to `tauri-apps/tauri-action`.

## `tauri.conf.json` (full)

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Zonevert",
  "version": "0.1.0",
  "identifier": "dev.zonevert.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Zonevert",
        "width": 1280,
        "height": 860,
        "minWidth": 920,
        "minHeight": 680,
        "backgroundColor": "#f4f5f7"
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "category": "Graphics",
    "shortDescription": "Batch image conversion with FFmpeg",
    "longDescription": "A Windows and Linux desktop UI for batch image conversion with FFmpeg.",
    "copyright": "Zonevert Maintainers",
    "linux": {
      "deb": {
        "depends": ["ffmpeg"]
      },
      "appimage": {
        "bundleMediaFramework": false
      }
    },
    "windows": {
      "nsis": {
        "installMode": "currentUser"
      },
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
      }
    }
  }
}
```

### Bundle targets

`bundle.targets: "all"` produces every format the platform supports. To match
the v0.1.0 artifact set exactly, use per-platform CLI flags instead:

```bash
# Linux (mirrors AppImage + deb)
tauri build --bundles deb,appimage

# Windows (mirrors nsis + portable)
tauri build --bundles nsis,msi
```

`portable`-equivalent: Tauri has no single-file "portable exe" target like
electron-builder's. Closest options:
- **NSIS** with `installMode: "currentUser"` → small installer, no admin.
- **MSI** → enterprise-friendly, larger.
- For a no-install build, ship the `release/<target>-release/` folder zipped
  (the raw `.exe` + WebView2 bootstrapper). Document this if "portable" is a
  hard requirement.

### Why each bundle field

- **`linux.deb.depends: ["ffmpeg"]`** — declares the apt dependency so `dpkg
  -i` warns if ffmpeg is missing. Does **not** bundle it (see
  [ffmpeg distribution](#ffmpeg-distribution)).
- **`linux.appimage.bundleMediaFramework: false`** — zonevert doesn't use
  media playback in the WebView; skip the ~20 MB of bundled gstreamer libs that
  flag would add. Saves AppImage size.
- **`windows.nsis.installMode: "currentUser"`** — no UAC prompt, installs to
  `%LOCALAPPDATA%`. Matches electron-builder's default `nsis.perMachine: false`.
- **`windows.webviewInstallMode: downloadBootstrapper`** — if WebView2 is
  absent, the installer downloads the ~2 MB Evergreen bootstrapper at install
  time rather than bundling ~150 MB of WebView2. Keeps the installer tiny. Use
  `embedBootstrapper` (offline) only for air-gapped users.

### Icons

Tauri needs `.png` (multiple sizes), `.icns` (macOS), `.ico` (Windows). The
existing `build/icon.png` / `build/icon.ico` map to:

```bash
# from repo root, after `pnpm tauri init`:
cp build/icon.png src-tauri/icons/128x128.png
cp build/icon.ico  src-tauri/icons/icon.ico
# generate the rest:
pnpm tauri icon build/icon.png   # auto-generates all sizes + icns + ico
```

`tauri icon` produces `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico` from one source PNG. Use a 1024×1024 source.

## ffmpeg distribution

Zonevert today **assumes ffmpeg/ffprobe on PATH** (spawned as `"ffmpeg"`). The
Tauri port preserves this. Three options, ranked by effort:

| Option | Effort | Bundle impact | UX |
|---|---|---|---|
| **A. Document the dependency** (current behavior) | none | none | user installs ffmpeg separately |
| B. Declare as package dep (deb `Depends: ffmpeg`) | low | none (deb only) | `apt install ./zonevert.deb` pulls ffmpeg |
| C. Sidecar ffmpeg binary | medium | +75–100 MB each arch | fully self-contained, defeats the size win |

**Recommendation: A + B.** Keep assuming PATH ffmpeg (so the existing
`probeFFmpeg` "is ffmpeg installed?" check still works), and add `Depends:
ffmpeg` to the deb so apt users get it automatically. **Do not bundle ffmpeg as
a sidecar** — that's the 75 MB you're trying to escape by leaving Electron.

If you later want self-containment without the size cost, offer a separate
"Zonevert + ffmpeg" download that bundles a sidecar (Tauri's `externalBin`
feature) for users who can't install ffmpeg — keep the default build slim.

## GitHub Actions

Replace the electron-builder matrix with `tauri-apps/tauri-action`. It
cross-builds per-OS on native runners (no Wine), signs, and uploads to a
GitHub Release in one step.

```yaml
# .github/workflows/release.yml
name: release

on:
  push:
    tags: ["v*"]
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
            args: "--bundles deb,appimage"
          - platform: windows-latest
            args: "--bundles nsis,msi"
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Install Linux system deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev
          # ffmpeg is NOT a build dep — it's a runtime dep declared in the deb.

      - uses: pnpm/action-setup@v4   # pick version from packageManager field
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - run: pnpm install --frozen-lockfile

      - name: Check
        run: |
          pnpm exec svelte-check --tsconfig ./tsconfig.json
          cargo check --manifest-path src-tauri/Cargo.toml
          node --test tests/*.test.cjs

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "${{ github.ref_name }}"
          releaseDraft: false
          prerelease: false
          args: ${{ matrix.args }}
```

### What this replaces

- **No Wine.** Windows runners build native `.exe`/`.msi`; Linux runners build
  `.deb`/`.AppImage`. The current flow's Wine-on-Linux problem vanishes.
- **No `electron-builder` config.** Bundler config is `tauri.conf.json#bundle`,
  read by `tauri-action` directly. `beforeBuildCommand` runs `vite build` first,
  so the Rust bundler packages the compiled Svelte frontend from `dist/`.
- **One action does build + upload + release.** Replaces the manual
  `actions/create-release` + `upload-release-asset` steps.

### Signing (optional, follow-up)

- **Windows code signing**: set `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env in the workflow; the updater
  (if enabled) signs the `.exe`. Needs an EV/OV cert.
- **macOS notarization**: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` +
  `APPLE_SIGNING_IDENTITY` (out of scope for Win/Linux-only v0.1).
- **Updater**: enable `tauri-plugin-updater` + a signing keypair; publish a
  `latest.json` feed (e.g. on the GitHub Release). Documented as a follow-up —
  Electron's `electron-updater` had no Tauri equivalent wired in v0.1.

## Expected bundle sizes

| Artifact | Electron v0.1.0 | Tauri (est.) |
|---|---|---|
| AppImage | 118 MB | ~8–12 MB |
| .deb | 92 MB | ~4–6 MB (+ ffmpeg pulled by apt, not bundled) |
| NSIS .exe | 98 MB | ~5–8 MB (+ WebView2 bootstrapper download on install) |
| MSI | — | ~6–9 MB |

The drop comes entirely from not bundling Chromium + Node. The Rust core +
WebView glue is ~3–5 MB; the rest is your 100 KB of assets + icons.

→ [06-checklist.md](./06-checklist.md) for verification before tagging.
