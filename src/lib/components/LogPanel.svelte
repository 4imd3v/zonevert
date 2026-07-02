<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";

  let logEl = $state<HTMLPreElement>();

  // Auto-scroll to bottom when logs change.
  $effect(() => {
    void appState.logs.length;
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  let logText = $derived(appState.logs.join(""));
</script>

<section class="panel log-panel" aria-labelledby="logTitle">
  <div class="panel-header">
    <div>
      <h2 id="logTitle">Log</h2>
      <p>{appState.logSummary}</p>
    </div>
    <button class="icon-button" type="button" aria-label="Clear log" title="Clear log" onclick={() => appState.clearLogs()}>
      <Icon name="x" />
    </button>
    <button class="icon-button" type="button" aria-label="Save log" title="Save log to file" onclick={() => appState.saveLog()}>
      <Icon name="folder" />
    </button>
  </div>
  <pre bind:this={logEl} tabindex="-1" role="log" aria-live="polite">{logText}</pre>
</section>
