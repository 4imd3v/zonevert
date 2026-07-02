# 1. Project Setup

Scaffold a Vite + Svelte 5 + TypeScript frontend with Tauri 2 as the backend.
The Rust core lives in `src-tauri/`; the frontend lives in `src/` (Svelte
components, not static HTML).

## Prerequisites

- **Node** ≥ 20 (you have 22 in CI already)
- **pnpm** (your `packageManager` is `pnpm@11.5.3`)
- **Rust** ≥ 1.77.2 (stable) via `rustup`
- **System WebView**:
  - Windows: WebView2 runtime (preinstalled on Win10 1809+ / Win11)
  - Linux: `webkit2gtk-4.1` + `libgtk-3` + build deps:
    ```bash
    sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libssl-dev
    ```
- **ffmpeg / ffprobe**: unchanged — still on the user's PATH. See
  [05-build-release.md](./05-build-release.md#ffmpeg-distribution).

## Scaffold

The cleanest path: `create-tauri-app` with the Svelte + TypeScript template,
then move your existing logic modules in. Run from a temp dir, then merge.

```bash
# 1. scaffold into a temp dir (don't clobber the current repo yet)
pnpm create tauri-app zonevert-tauri --template svelte-ts --manager pnpm --yes

# 2. copy the Tauri scaffolding into your repo
cp -r zonevert-tauri/src-tauri ./src-tauri
cp zonevert-tauri/src/lib/App.svelte ./src/lib/App.svelte   # then overwrite (see 07)
cp zonevert-tauri/vite.config.ts .
cp zonevert-tauri/svelte.config.js .
cp zonevert-tauri/tsconfig.json .
rm -rf zonevert-tauri
```

Or, init Tauri into the existing repo manually:

```bash
pnpm add -D @tauri-apps/cli@latest
pnpm add @tauri-apps/api@latest @tauri-apps/plugin-dialog @tauri-apps/plugin-notification
pnpm add -D vite @sveltejs/vite-plugin-svelte svelte svelte-check typescript
pnpm tauri init
```

`tauri init` prompts — answer for a Vite frontend:

| Prompt | Answer |
|---|---|
| App name | `Zonevert` |
| Window title | `Zonevert` |
| Web assets dir (relative to `src-tauri/`) | `../dist` |
| Dev server URL | `http://localhost:5173` |
| Frontend dev command | `pnpm dev` |
| Frontend build command | `pnpm build` |

## `vite.config.ts`

```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  // Tauri expects a fixed port; Vite's default is 5173.
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
  resolve: {
    alias: {
      // `$lib` alias so components import from `$lib/bindings`, `$lib/logic/...`
      // — matches the SvelteKit convention without needing SvelteKit.
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
});
```

## `svelte.config.js`

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
```

## `tsconfig.json`

Extends Svelte's recommended config. Keeps `strict` on; the renderer DOM code
that was excluded from type-checking before now gets proper types via Svelte's
template checking.

```jsonc
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "$lib": ["./src/lib"], "$lib/*": ["./src/lib/*"] },
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "src/**/*.js"],
  "exclude": ["src-tauri"]
}
```

## Resulting structure

```
zonevert/
├─ src/                          # Vite frontend root
│  ├─ main.ts                    # mounts App.svelte
│  ├─ app.html                   # Vite HTML template (replaces index.html)
│  ├─ lib/
│  │  ├─ bindings.ts             # typed invoke() wrappers (see 04-frontend.md)
│  │  ├─ stores/
│  │  │  └─ app-state.svelte.ts  # $state class — shared state (see 07)
│  │  ├─ components/
│  │  │  ├─ App.svelte
│  │  │  ├─ Topbar.svelte
│  │  │  ├─ SummaryStrip.svelte
│  │  │  ├─ SourcePanel.svelte
│  │  │  ├─ OutputPanel.svelte
│  │  │  ├─ NamingPanel.svelte
│  │  │  ├─ ResizePanel.svelte
│  │  │  ├─ AdvancedPanel.svelte
│  │  │  ├─ CommandPanel.svelte
│  │  │  ├─ QueuePanel.svelte
│  │  │  └─ LogPanel.svelte
│  │  └─ logic/
│  │     ├─ conversion-plan.ts  # ported from conversion-plan.js (types added)
│  │     ├─ queue-state.ts      # ported from queue-state.js
│  │     ├─ ipc-validation.ts   # ported from ipc-validation.js
│  │     └─ progress-parser.ts  # ported from progress-parser.js
│  └─ styles.css                 # global styles (moved from old src/)
├─ src-tauri/                     # Rust backend (see 03-rust-backend.md)
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  ├─ icons/
│  ├─ capabilities/
│  │  └─ default.json
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     ├─ commands.rs
│     ├─ ffmpeg.rs
│     └─ state.rs
├─ tests/                         # pure-logic tests, unchanged
│  ├─ conversion-plan.test.cjs
│  └─ ...
├─ scripts/
└─ package.json
```

> The old Electron files (`src/main.js`, `src/preload.js`, `src/renderer.js`,
> `src/index.html`, `scripts/install-electron-runtime.cjs`) are deleted in the
> final step — keep them as reference until the Svelte port is verified.

## `tauri.conf.json`

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
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "category": "Graphics"
  }
}
```

### Why each field

- **`build.frontendDist: "../dist"`** — Vite builds to `dist/`; Tauri packages
  that. In dev, `devUrl` serves from Vite's dev server instead.
- **`build.beforeDevCommand` / `beforeBuildCommand`** — Tauri runs Vite for you
  (start dev server / production build) before launching the app. No separate
  `pnpm dev` step needed.
- **`app.withGlobalTauri` is omitted (false)** — the bindings module imports
  from `@tauri-apps/api` (npm), which Vite bundles. This is the idiomatic
  Svelte/Vite path and gives TypeScript types. No `window.__TAURI__` globals.
- **`app.security.csp`** — `img-src 'self' data:` for thumbnail data URLs;
  `style-src 'unsafe-inline'` allows Svelte's scoped `<style>` injection.
  `script-src 'self'` blocks inline handlers (Svelte uses `addEventListener`).

## `package.json` scripts

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "tauri": "tauri",
    "package:linux": "tauri build --bundles deb,appimage",
    "package:windows": "tauri build --bundles nsis,msi",
    "check": "svelte-check --tsconfig ./tsconfig.json && node --test tests/*.test.cjs",
    "typecheck": "svelte-check --tsconfig ./tsconfig.json"
  }
}
```

- `vite` / `vite build` — frontend dev server / production build. `tauri dev`
  / `tauri build` invoke these via `beforeDevCommand` / `beforeBuildCommand`.
- `svelte-check` replaces `tsc --noEmit` for Svelte template type-checking; it
also needs to resolve the `$lib` alias — add a `paths` mapping in
`tsconfig.json` so the type checker follows the same alias as Vite:

```jsonc
"compilerOptions": {
  // ...existing...
  "baseUrl": ".",
  "paths": { "$lib": ["./src/lib"], "$lib/*": ["./src/lib/*"] }
}
```
- `node --test tests/*.test.cjs` — the existing pure-JS logic tests keep
  passing; they test `conversion-plan` etc., which work as `.js` or `.ts`.

## Plugins

```bash
pnpm tauri add dialog
pnpm tauri add notification
```

These add the Rust crate + JS package. With the npm approach (no
`withGlobalTauri`), the JS packages are required — `bindings.ts` imports from
them.

## Next

→ [02-ipc-mapping.md](./02-ipc-mapping.md) for the handler-by-handler port.
