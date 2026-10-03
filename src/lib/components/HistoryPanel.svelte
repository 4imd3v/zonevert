<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { formatLabel } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";
  import type { HistoryEntry } from "$lib/stores/app-state.svelte";

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? `Today ${time}` : d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
  }

  function restore(entry: HistoryEntry) {
    appState.restoreHistory(entry);
  }
</script>

<section class="panel" aria-label="Past runs">
  {#if !appState.history.length}
    <div class="empty-state empty-state--centered">
      <Icon name="rotate" />
      <span>Past conversions will appear here.</span>
    </div>
  {:else}
    <div class="queue-list" role="list">
      {#each appState.history as entry (entry.timestamp)}
        <div class="queue-row queue-row--done" role="listitem">
          <div>
            <strong>{formatTime(entry.timestamp)}</strong>
            <span>
              {entry.fileCount} file{entry.fileCount === 1 ? "" : "s"} → {formatLabel(entry.settings.format)}, quality {entry.settings.quality}
            </span>
            <span>
              {entry.summary.done} done{#if entry.summary.failed}, {entry.summary.failed} failed{/if}{#if entry.summary.skipped}, {entry.summary.skipped} skipped{/if}
            </span>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Restore settings from this run"
            title="Restore settings from this run"
            onclick={() => restore(entry)}
          >
            <Icon name="rotate" />
          </button>
        </div>
      {/each}
    </div>

    <div class="advanced-button-row">
      <button class="secondary-button" type="button" onclick={() => appState.clearHistory()}>
        <Icon name="trash" />
        Clear history
      </button>
    </div>
  {/if}
</section>
