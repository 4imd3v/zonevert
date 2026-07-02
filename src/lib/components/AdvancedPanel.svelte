<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";
</script>

<details class="panel advanced-panel">
  <summary>
    <span>Advanced FFmpeg</span>
    <Icon name="terminal" />
  </summary>

  <label class="field">
    <span>FFmpeg path</span>
    <input type="text" spellcheck="false" placeholder="ffmpeg" bind:value={appState.settings.ffmpegPath} oninput={() => appState.persistSettings()} />
  </label>

  <label class="field">
    <span>Parallel jobs</span>
    <input type="number" min="1" max="8" step="1" inputmode="numeric" bind:value={appState.settings.concurrency} onchange={() => appState.persistSettings()} />
  </label>

  <label class="field">
    <span>Global args</span>
    <input type="text" spellcheck="false" bind:value={appState.settings.globalArgs} oninput={() => appState.persistSettings()} />
  </label>

  <label class="field">
    <span>Input args</span>
    <input type="text" spellcheck="false" bind:value={appState.settings.inputArgs} oninput={() => appState.persistSettings()} />
  </label>

  <label class="field">
    <span>Filter graph</span>
    <input type="text" spellcheck="false" bind:value={appState.settings.filter} oninput={() => appState.persistSettings()} />
  </label>

  <label class="field">
    <span>Output args</span>
    <input type="text" spellcheck="false" bind:value={appState.settings.outputArgs} oninput={() => appState.persistSettings()} />
  </label>

  <div class="advanced-button-row">
    <button class="secondary-button" type="button" onclick={() => appState.probeFfmpeg()}>
      <Icon name="check" />
      Check FFmpeg
    </button>
    <button class="secondary-button" type="button" onclick={() => appState.resetSettings()}>
      <Icon name="trash" />
      Reset to defaults
    </button>
  </div>
</details>
