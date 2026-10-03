<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import SourcePanel from "./SourcePanel.svelte";
  import OutputPanel from "./OutputPanel.svelte";
  import VideoPanel from "./VideoPanel.svelte";
  import NamingPanel from "./NamingPanel.svelte";
  import ResizePanel from "./ResizePanel.svelte";
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import CommandPanel from "./CommandPanel.svelte";
  import QueuePanel from "./QueuePanel.svelte";
  import LogPanel from "./LogPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";

  const TABS = [
    { id: "output", label: "Output" },
    { id: "video", label: "Video" },
    { id: "transform", label: "Resize" },
    { id: "naming", label: "Names" },
    { id: "advanced", label: "Advanced" },
  ];
  const RUN_TABS = [
    { id: "queue", label: "Queue" },
    { id: "log", label: "Log" },
    { id: "history", label: "History" },
  ];

  // Tab choice survives a restart, like the settings themselves.
  let activeTab = $state(loadTab("zonevert:tab", TABS, "output"));
  let activeRunTab = $state(loadTab("zonevert:run-tab", RUN_TABS, "queue"));

  $effect(() => saveTab("zonevert:tab", activeTab));
  $effect(() => saveTab("zonevert:run-tab", activeRunTab));

  let hasFiles = $derived(appState.files.length > 0);

  function loadTab(key: string, tabs: { id: string }[], fallback: string): string {
    try {
      const stored = localStorage.getItem(key);
      if (stored && tabs.some((tab) => tab.id === stored)) return stored;
    } catch {
      // localStorage may be unavailable
    }
    return fallback;
  }

  function saveTab(key: string, id: string) {
    try {
      localStorage.setItem(key, id);
    } catch {
      // localStorage may be unavailable
    }
  }
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
    </div>

    {#if !hasFiles}
      <p class="col-hint">Add source files to preview per-file output names and sizes.</p>
    {/if}
  </div>

  <div class="col col-run">
    <div class="tab-bar tab-bar--run" role="tablist" aria-label="Run output">
      {#each RUN_TABS as tab (tab.id)}
        <button
          id="run-tab-{tab.id}"
          type="button"
          role="tab"
          aria-selected={activeRunTab === tab.id}
          aria-controls="run-panel-{tab.id}"
          class:is-active={activeRunTab === tab.id}
          onclick={() => (activeRunTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="tab-body">
      <div id="run-panel-queue" role="tabpanel" aria-labelledby="run-tab-queue" hidden={activeRunTab !== "queue"}>
        <QueuePanel />
      </div>
      <div id="run-panel-log" role="tabpanel" aria-labelledby="run-tab-log" hidden={activeRunTab !== "log"}>
        <LogPanel />
      </div>
      <div id="run-panel-history" role="tabpanel" aria-labelledby="run-tab-history" hidden={activeRunTab !== "history"}>
        <HistoryPanel />
      </div>
    </div>

    <CommandPanel />
  </div>
</section>
