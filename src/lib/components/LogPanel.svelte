<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";

  let logEl = $state<HTMLPreElement>();

  // Auto-scroll to bottom when logs change, but only if the user
  // hasn't scrolled up to read earlier output.
  $effect(() => {
    void appState.logs.length;
    if (!logEl) return;
    const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    if (atBottom) logEl.scrollTop = logEl.scrollHeight;
  });

  let logText = $derived(appState.logs.join(""));
</script>

<section class="panel log-panel" aria-labelledby="logTitle">
  <div class="panel-header">
    <div>
      <h2 id="logTitle">Log</h2>
      <p>{appState.logSummary}</p>
    </div>
    <div class="button-row">
      <button class="icon-button" type="button" aria-label="Clear log" title="Clear log" onclick={() => appState.clearLogs()}>
        <Icon name="x" />
      </button>
      <button class="icon-button" type="button" aria-label="Save log" title="Save log to file" onclick={() => appState.saveLog()}>
        <Icon name="folder" />
      </button>
    </div>
  </div>
  <pre
    bind:this={logEl}
    class:is-idle={!logText}
    tabindex="-1"
    role="log"
    aria-live="polite">{#if logText}{logText}{:else}FFmpeg output will stream here while converting…{/if}</pre>
</section>
