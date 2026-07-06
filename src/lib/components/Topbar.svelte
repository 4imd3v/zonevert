<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import logoUrl from "$lib/assets/Zonevert.png";
  import Icon from "./Icon.svelte";

  // Sync theme to <html data-theme> whenever it changes.
  $effect(() => {
    document.documentElement.dataset.theme = appState.theme;
  });
</script>

<header class="app-header">
  <div class="brand-block">
    <div class="brand-mark" aria-hidden="true">
      <img src={logoUrl} alt="Zonevert" width="18" height="18" />
    </div>
    <div class="brand-text">
      <h1>Zonevert</h1>
    </div>
  </div>
  <button class="icon-button" type="button" aria-label="Toggle dark mode" title="Toggle dark mode" onclick={() => appState.toggleTheme()}>
    {#if appState.theme === "dark"}
      <Icon name="sun" />
    {:else}
      <Icon name="moon" />
    {/if}
  </button>
</header>
