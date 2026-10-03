<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  let count = $derived(appState.files.length);
  let selected = $derived(
    appState.selectedFileIndex >= 0 ? appState.files[appState.selectedFileIndex] : undefined,
  );
  let filesTitle = $derived(
    selected ? `${count} files · selected: ${selected.name}` : `${count} files`,
  );
  let ffmpegLabel = $derived(appState.ffmpegVersion || (appState.ffmpegStatus === "ok" ? "FFmpeg ready" : "Checking FFmpeg"));
</script>

<footer class="status-bar" aria-label="Application status">
  <span class="status-bar__files" title={filesTitle}>
    <strong>{count}</strong> file{count === 1 ? "" : "s"}{#if selected} · {selected.name}{/if}
  </span>
  {#if appState.sizeSummary}
    <span class="status-bar__size" title="Size of the last completed run">Size: {appState.sizeSummary}</span>
  {/if}
  <span class="status-bar__ffmpeg" title={ffmpegLabel}>
    <span class="status-dot status-dot--{appState.ffmpegStatus}"></span>
    {ffmpegLabel}
  </span>
</footer>
