<script lang="ts">
  // Phase 1 scaffold placeholder. Real component tree + bindings land in
  // Phase 3 (bindings.ts) and Phase 7 (components) — see migrate/07-svelte-frontend.md.
  let clicks = $state(0);
</script>

<main class="app-shell">
  <header class="topbar">
    <div class="brand-block">
      <div>
        <h1>Zonevert</h1>
        <p>Tauri + Svelte 5 + TS scaffold — Phase 1 OK</p>
      </div>
    </div>
  </header>

  <section class="workspace">
    <div class="panel">
      <h2>Scaffold status</h2>
      <p>Window opens ✓ · Vite HMR ✓ · svelte-check ✓</p>
      <p>
        Bindings, Rust backend, and components arrive in later phases. Button
        below proves runes work:
      </p>
      <button class="primary-button" onclick={() => clicks++}>
        Runes work: {clicks}
      </button>
    </div>
  </section>
</main>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
  }
  .workspace {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .primary-button {
    padding: 8px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
  }
</style>
