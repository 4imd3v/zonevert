import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);

// Vitest harness for store/UI-flow tests. The pure-logic suites stay on
// node:test + tsx (tests/*.test.ts, zero config); this config exists only
// because the store is a .svelte.ts runes module that needs the Svelte
// compiler (and jsdom for document/localStorage).
export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/store/**/*.test.ts"],
  },
});
