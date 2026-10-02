<script lang="ts">
  import SourcePanel from "./SourcePanel.svelte";
  import OutputPanel from "./OutputPanel.svelte";
  import VideoPanel from "./VideoPanel.svelte";
  import NamingPanel from "./NamingPanel.svelte";
  import ResizePanel from "./ResizePanel.svelte";
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import CommandPanel from "./CommandPanel.svelte";
  import QueuePanel from "./QueuePanel.svelte";
  import LogPanel from "./LogPanel.svelte";

  const TABS = [
    { id: "output", label: "Output" },
    { id: "video", label: "Video" },
    { id: "transform", label: "Transform" },
    { id: "naming", label: "Naming" },
    { id: "advanced", label: "Advanced" },
    { id: "history", label: "History" },
  ];

  let activeTab = $state("output");
</script>

<section class="workspace" aria-label="Conversion workspace">
  <div class="col col-sources">
    <SourcePanel />
  </div>

  <div class="col col-settings">
    <div class="tab-bar" role="tablist" aria-label="Settings">
      {#each TABS as tab (tab.id)}
        <button
          id="settings-tab-{tab.id}"
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls="settings-panel-{tab.id}"
          class:is-active={activeTab === tab.id}
          onclick={() => (activeTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="tab-body">
      <div id="settings-panel-output" role="tabpanel" aria-labelledby="settings-tab-output" hidden={activeTab !== "output"}>
        <OutputPanel />
      </div>
      <div id="settings-panel-video" role="tabpanel" aria-labelledby="settings-tab-video" hidden={activeTab !== "video"}>
        <VideoPanel />
      </div>
      <div id="settings-panel-transform" role="tabpanel" aria-labelledby="settings-tab-transform" hidden={activeTab !== "transform"}>
        <ResizePanel />
      </div>
      <div id="settings-panel-naming" role="tabpanel" aria-labelledby="settings-tab-naming" hidden={activeTab !== "naming"}>
        <NamingPanel />
      </div>
      <div id="settings-panel-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced" hidden={activeTab !== "advanced"}>
        <AdvancedPanel />
      </div>
      <div id="settings-panel-history" role="tabpanel" aria-labelledby="settings-tab-history" hidden={activeTab !== "history"}>
        <HistoryPanel />
      </div>
    </div>
  </div>

  <div class="col col-run">
    <QueuePanel />
    <CommandPanel />
    <LogPanel />
  </div>
</section>
