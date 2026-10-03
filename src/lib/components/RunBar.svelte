<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { formatLabel } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";

  let count = $derived(appState.files.length);
  let formatText = $derived(formatLabel(appState.settings.format));
  let eta = $derived(appState.etaText);
  let canCancel = $derived(appState.isConverting && !appState.cancelRequested);
  let canStopAfter = $derived(appState.isConverting && !appState.stopAfterCurrent);
  let showRetry = $derived(appState.hasFailed && !appState.isConverting);
  let convertLabel = $derived(appState.isConverting ? "Converting" : "Convert");
</script>

<footer class="run-bar" aria-label="Run controls">
  <div class="run-bar__summary">
    <span>
      <strong>{count}</strong> file{count === 1 ? "" : "s"} → {formatText} · quality {appState.settings.quality}
    </span>
    {#if appState.sizeSummary}
      <span class="run-bar__stat">{appState.sizeSummary}</span>
    {/if}
    {#if eta}
      <span class="run-bar__stat">{eta}</span>
    {/if}
  </div>

  <div class="button-row">
    <button class="secondary-button" type="button" hidden={!showRetry} onclick={() => appState.retryFailed()}>
      <Icon name="rotate" />
      Retry failed
    </button>
    <button class="icon-button" type="button" aria-label="Stop after current" title="Stop after current job" disabled={!canStopAfter} onclick={() => appState.stopAfterCurrentJob()}>
      <Icon name="square" />
    </button>
    <button class="icon-button danger-button" type="button" aria-label="Cancel current job" title="Cancel immediately (Esc)" disabled={!canCancel} onclick={() => appState.cancelCurrentJob()}>
      <Icon name="x-circle" />
    </button>
    <button
      class="primary-button"
      class:is-busy={appState.isConverting}
      aria-busy={appState.isConverting}
      type="button"
      title="Convert (Ctrl+Enter)"
      disabled={!appState.canConvert}
      onclick={() => appState.runConversion()}
    >
      <Icon name="play" />
      <span>{convertLabel}</span>
    </button>
  </div>
</footer>
