<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { basename } from "$lib/logic/conversion-plan";
  import logoUrl from "$lib/assets/Zonevert.png";
  import Icon from "./Icon.svelte";

  // Sync theme to <html data-theme> whenever it changes.
  $effect(() => {
    document.documentElement.dataset.theme = appState.theme;
  });

  let folderLabel = $derived(appState.outputDir ? basename(appState.outputDir) : "Same folder as source");
  let folderTitle = $derived(appState.outputDir || "Output is written beside each source file");
  let helpOpen = $state(false);
</script>

<header class="app-header">
  <div class="brand-block" title="Zonevert v{__APP_VERSION__}">
    <div class="brand-mark" aria-hidden="true">
      <img src={logoUrl} alt="Zonevert" width="18" height="18" />
    </div>
    <div class="brand-text">
      <h1>Zonevert</h1>
    </div>
    <span class="brand-version">v{__APP_VERSION__}</span>
  </div>

  <button
    class="output-folder-button"
    type="button"
    title="Output folder — {folderTitle}. Click to change."
    onclick={() => appState.pickOutputDir()}
  >
    <Icon name="folder" />
    <span>{folderLabel}</span>
  </button>

  <div class="header-actions">
    <details class="help" bind:open={helpOpen}>
      <summary title="Keyboard shortcuts"><Icon name="help" /></summary>
      {#if helpOpen}
        <button class="help-backdrop" type="button" aria-label="Close shortcuts" onclick={() => (helpOpen = false)}></button>
      {/if}
      <div class="help-popover">
        <h2>Keyboard shortcuts</h2>
        <dl>
          <dt>Ctrl + O</dt><dd>Add files</dd>
          <dt>Ctrl + Enter</dt><dd>Convert queue</dd>
          <dt>Esc</dt><dd>Cancel current job</dd>
          <dt>Delete</dt><dd>Remove selected file</dd>
          <dt>Ctrl + Shift + C</dt><dd>Copy command</dd>
        </dl>
      </div>
    </details>
    <button class="icon-button" type="button" aria-label="Toggle dark mode" title="Toggle dark mode" onclick={() => appState.toggleTheme()}>
      {#if appState.theme === "dark"}
        <Icon name="sun" />
      {:else}
        <Icon name="moon" />
      {/if}
    </button>
  </div>
</header>
