<script lang="ts">
  import SourcePanel from "./SourcePanel.svelte";
  import OutputPanel from "./OutputPanel.svelte";
  import NamingPanel from "./NamingPanel.svelte";
  import ResizePanel from "./ResizePanel.svelte";
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import CommandPanel from "./CommandPanel.svelte";
  import QueuePanel from "./QueuePanel.svelte";
  import LogPanel from "./LogPanel.svelte";
</script>

<section class="workspace" aria-label="Conversion workspace">
  <div class="setup-column pane">
    <div class="pane-title">Setup</div>
    <SourcePanel />
    <OutputPanel />
    <NamingPanel />
    <ResizePanel />
    <AdvancedPanel />
  </div>

  <div class="run-column pane">
    <div class="pane-title">Run</div>
    <CommandPanel />
    <QueuePanel />
    <LogPanel />
  </div>
</section>
