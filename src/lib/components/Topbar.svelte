<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";

  // Sync theme to <html data-theme> whenever it changes.
  $effect(() => {
    document.documentElement.setAttribute("data-theme", appState.theme);
  });
</script>

<header class="app-header">
  <div class="brand-block">
    <div class="brand-mark" aria-hidden="true">
      <Icon name="image" />
    </div>
    <div class="brand-text">
      <h1>Zonevert</h1>
      <p>FFmpeg image conversion</p>
    </div>
  </div>
  <div class="header-right">
    <div class="ffmpeg-status">
      <span class="status-dot status-dot--{appState.ffmpegStatus}"></span>
      <span class="ffmpeg-status-text">{appState.ffmpegVersion || (appState.ffmpegStatus === "ok" ? "FFmpeg ready" : "Checking FFmpeg")}</span>
    </div>
    <button class="icon-button" type="button" aria-label="Toggle dark mode" title="Toggle dark mode" onclick={() => appState.toggleTheme()}>
      {#if appState.theme === "dark"}
        <Icon name="sun" />
      {:else}
        <Icon name="moon" />
      {/if}
    </button>
  </div>
</header>
