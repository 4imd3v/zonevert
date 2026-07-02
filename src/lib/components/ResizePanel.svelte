<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  let summary = $derived.by(() => {
    const intent = appState.intent;
    const filter = appState.buildResizeFilterText();
    if (!filter) return "Original dimensions";

    if (appState.files.length && appState.imageMeta.size) {
      const firstFile = appState.files[0];
      const meta = appState.imageMeta.get(firstFile.path);
      if (meta) {
        const [sw, sh] = meta.split("×");
        let targetW: string | number = sw;
        let targetH: string | number = sh;
        if (intent.resize.mode === "stretch" || (intent.resize.mode === "fill" && intent.resize.width && intent.resize.height)) {
          targetW = intent.resize.width || sw;
          targetH = intent.resize.height || sh;
        } else if (intent.resize.mode === "inside") {
          targetW = intent.resize.width || `${sw}→`;
          targetH = intent.resize.height || `${sh}→`;
        }
        return `${sw}×${sh} → ${targetW}×${targetH}`;
      }
    }
    return filter;
  });
</script>

<section class="panel" aria-labelledby="resizeTitle">
  <div class="panel-header">
    <div>
      <h2 id="resizeTitle">Resize</h2>
      <p>{summary}</p>
    </div>
  </div>

  <div class="field-grid">
    <label class="field">
      <span>Mode</span>
      <select bind:value={appState.settings.resizeMode} onchange={() => appState.persistSettings()}>
        <option value="none">None</option>
        <option value="inside">Fit inside</option>
        <option value="fill">Fill and crop</option>
        <option value="stretch">Stretch</option>
      </select>
    </label>
    <label class="field">
      <span>Width</span>
      <input type="number" min="1" step="1" inputmode="numeric" bind:value={appState.settings.width} oninput={() => appState.persistSettings()} />
    </label>
    <label class="field">
      <span>Height</span>
      <input type="number" min="1" step="1" inputmode="numeric" bind:value={appState.settings.height} oninput={() => appState.persistSettings()} />
    </label>
  </div>
</section>
