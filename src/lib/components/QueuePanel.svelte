<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { itemEtaSeconds, statusLabel, type QueueItem } from "$lib/logic/queue-state";
  import { formatDuration } from "$lib/logic/media-probe";
  import { basename } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";

  let queueSummary = $derived(appState.queueSummary);
  let eta = $derived(appState.etaText);
  let summaryText = $derived(eta ? `${queueSummary.text} · ${eta}` : queueSummary.text);

  function formatItemProgress(item: QueueItem): string {
    if (item.status !== "running" || !item.progress) return "";
    const parts: string[] = [];
    if (item.progress.time) parts.push(item.progress.time);
    if (item.progress.speed !== null) parts.push(`${item.progress.speed}x`);
    if (item.progress.elapsed) parts.push(`elapsed ${item.progress.elapsed}`);
    const etaSec = itemEtaSeconds(item);
    if (etaSec != null) parts.push(`~${formatDuration(etaSec)} left`);
    return parts.join(" · ");
  }
</script>

<section class="panel queue-panel" aria-labelledby="queueTitle">
  <div class="panel-header">
    <div>
      <h2 id="queueTitle">Queue</h2>
      <p>{summaryText}</p>
    </div>
  </div>

  <div class="queue-progress" role="progressbar" aria-label="Queue progress" aria-valuenow={queueSummary.progress} aria-valuemin="0" aria-valuemax="100">
    <span style="width: {queueSummary.progress}%"></span>
  </div>

  <div class="queue-list" role="list">
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
            {#if item.status === "running" && item.progressPercent != null}
              <div
                class="queue-item-progress"
                role="progressbar"
                aria-label="{item.file.name} progress"
                aria-valuenow={item.progressPercent}
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span style="width: {item.progressPercent}%"></span>
              </div>
            {/if}
          </div>
          <span>{statusLabel(item.status)}</span>
        </div>
      {/each}
    {/if}
  </div>
</section>
