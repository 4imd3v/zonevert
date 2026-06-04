# Zonevert

Zonevert is a Windows and Linux desktop UI for batch image conversion through FFmpeg.

## Requirements

- Node.js and pnpm
- FFmpeg installed on `PATH`, or a custom FFmpeg path entered in the app

## Run

```bash
pnpm install
pnpm start
```

`pnpm start` disables Chromium's sandbox for local development because Electron's downloaded `chrome-sandbox` helper is often not root-owned on Linux development machines. Use `pnpm run start:sandboxed` only when that helper is configured correctly.

The UI can also be previewed by opening [src/index.html](src/index.html), but file dialogs and conversion only run inside Electron.

## Package

Build on the target operating system when possible:

```bash
pnpm run package:linux
pnpm run package:windows
```

Linux packaging outputs AppImage and deb artifacts. Windows packaging outputs NSIS and portable artifacts. Building Windows installers from Linux may require Wine and additional signing setup.

Generated package output is ignored by Git. To remove local build artifacts before broad source searches or fresh packaging runs:

```bash
pnpm run clean
```

## FFmpeg Scope

The main controls cover common image conversion needs: format, quality, overwrite behavior, metadata, resize mode, and batch queue execution. The Advanced FFmpeg section exposes global, input, filter graph, and output arguments so FFmpeg options can be used without changing the UI code.

The renderer adapts UI state into a conversion intent, while `src/conversion-plan.js` builds FFmpeg arguments and `src/queue-state.js` owns queue lifecycle status transitions. These modules are covered by `pnpm run check`.
