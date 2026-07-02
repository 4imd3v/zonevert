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
