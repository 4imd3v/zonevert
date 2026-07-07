<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { statusLabel } from "$lib/logic/queue-state";
  import { basename } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";

  let queueSummary = $derived(appState.queueSummary);
  let eta = $derived(appState.etaText);
  let summaryText = $derived(eta ? `${queueSummary.text} · ${eta}` : queueSummary.text);

  let hasRunning = $derived(appState.queue.some((item) => item.status === "running"));
  let canCancel = $derived(appState.isConverting && hasRunning && !appState.cancelRequested);
  let showRetry = $derived(appState.hasFailed && !appState.isConverting);
  let convertLabel = $derived(appState.isConverting ? "Converting" : "Convert");

  function formatItemProgress(item: { status: string; progress?: { frame: number | null; fps: number | null; time: string | null } }): string {
    if (item.status !== "running" || !item.progress) return "";
    const parts: string[] = [];
    if (item.progress.frame !== null) parts.push(`frame ${item.progress.frame}`);
    if (item.progress.fps !== null) parts.push(`${item.progress.fps} fps`);
    if (item.progress.time) parts.push(item.progress.time);
    return parts.join(" · ");
  }
</script>

<section class="panel queue-panel" aria-labelledby="queueTitle">
  <div class="panel-header">
    <div>
      <h2 id="queueTitle">Queue</h2>
      <p>{summaryText}</p>
    </div>
    <div class="button-row">
      <button class="primary-button" type="button" title="Convert (Ctrl+Enter)" disabled={!appState.canConvert} class:is-busy={appState.isConverting} aria-busy={appState.isConverting} onclick={() => appState.runConversion()}>
        <Icon name="play" />
        <span>{convertLabel}</span>
      </button>
      <button class="secondary-button" type="button" aria-label="Retry failed conversions" title="Retry failed" hidden={!showRetry} onclick={() => appState.retryFailed()}>
        <Icon name="play" />
        Retry failed
      </button>
      <button class="icon-button danger-button" type="button" aria-label="Cancel current job" title="Cancel current job (Esc)" disabled={!canCancel} onclick={() => appState.cancelCurrentJob()}>
        <Icon name="x-circle" />
      </button>
    </div>
  </div>

  <div class="queue-progress" role="progressbar" aria-label="Queue progress" aria-valuenow={queueSummary.progress} aria-valuemin="0" aria-valuemax="100">
    <span style="width: {queueSummary.progress}%"></span>
  </div>

  <div class="queue-list">
    {#if !appState.queue.length}
      <div class="empty-state">
        <Icon name="terminal" />
        <span>Conversion jobs will appear here.</span>
      </div>
    {:else}
      {#each appState.queue as item, index (item.id)}
        <div
          class="queue-row queue-row--{item.status}"
          class:queue-row--draggable={!appState.isConverting}
          role="listitem"
          draggable={!appState.isConverting}
          ondragstart={(e) => { e.dataTransfer?.setData("text/plain", String(index)); }}
          ondragover={(e) => { e.preventDefault(); }}
          ondrop={(e) => { e.preventDefault(); const from = Number(e.dataTransfer?.getData("text/plain")); if (!Number.isNaN(from)) appState.reorderQueue(from, index); }}
        >
          <div>
            <strong>{item.file.name || basename(item.file.path)}</strong>
            <span>{item.outputPath}</span>
            <span class="queue-progress-text">{formatItemProgress(item)}</span>
          </div>
          <span>{statusLabel(item.status)}</span>
        </div>
      {/each}
    {/if}
  </div>
</section>
