<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";

  let command = $derived(appState.buildCommand());

  let summary = $derived.by(() => {
    if (!appState.files.length) return "Waiting for source images";
    if (!appState.outputDir) return "Output goes beside each source";
    return `${appState.files.length} output file${appState.files.length === 1 ? "" : "s"}`;
  });

  // Keep commandSummary synced with the latest non-action text.
  $effect(() => {
    void appState.files.length;
    void appState.outputDir;
    appState.commandSummary = summary;
  });
</script>

<section class="panel command-panel" aria-labelledby="commandTitle">
  <div class="panel-header">
    <div>
      <h2 id="commandTitle">Command</h2>
      <p>{appState.commandSummary}</p>
    </div>
    <button class="icon-button" type="button" aria-label="Copy command" title="Copy command (Ctrl+Shift+C)" onclick={() => appState.copyCommand()}>
      <Icon name="copy" />
    </button>
    <button class="icon-button" type="button" aria-label="Export as script" title="Export commands as script" onclick={() => appState.exportScript()}>
      <Icon name="folder" />
    </button>
  </div>
  <pre>{command}</pre>
</section>
