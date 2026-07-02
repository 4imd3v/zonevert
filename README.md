# Zonevert

Zonevert is a Windows and Linux desktop UI for batch image conversion through FFmpeg.

## Requirements

- Node.js and pnpm
- Rust toolchain (stable ≥ 1.77.2)
- System WebView: WebView2 on Windows, `webkit2gtk-4.1` + `libgtk-3` on Linux
- FFmpeg installed on `PATH`, or a custom FFmpeg path entered in the app

## Run

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the Vite dev server (HMR) and launches the Tauri window.

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
pnpm run package:linux
pnpm run package:windows
```

Linux packaging outputs `.deb` and `.AppImage`. Windows packaging outputs NSIS
and MSI installers. Cross-building Windows installers from Linux requires Wine.

Generated package output is ignored by Git. To remove local build artifacts:

```bash
pnpm run clean
```

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
