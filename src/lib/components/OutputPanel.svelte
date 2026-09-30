<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";

  const QUALITY_HINTS: Record<string, string> = {
    webp: "Recommended: 75-85 for web photos",
    jpg: "Recommended: 85-95 for photos",
    png: "Quality only affects compression level",
    avif: "Recommended: 30-50 (lower = better quality)",
    jp2: "Recommended: 70-90",
    jls: "Recommended: 70-90",
  };

  let folderText = $derived(appState.outputDir || "Same folder as each source");
  let qualityHint = $derived(QUALITY_HINTS[appState.settings.format] ?? "");
  let encoderWarning = $derived(appState.encoderWarning);
</script>

<section class="panel" aria-labelledby="outputTitle">
  <div class="panel-header">
    <div>
      <h2 id="outputTitle">Output</h2>
      <p>{folderText}</p>
    </div>
    <button class="icon-button" type="button" aria-label="Choose output folder" title="Choose output folder" onclick={() => appState.pickOutputDir()}>
      <Icon name="folder" />
    </button>
  </div>

  <div class="field-grid">
    <label class="field">
      <span>Format</span>
      <select bind:value={appState.settings.format} onchange={() => appState.persistSettings()}>
        <option value="webp">WebP</option>
        <option value="jpg">JPEG</option>
        <option value="png">PNG</option>
        <option value="avif">AVIF</option>
        <option value="tiff">TIFF</option>
        <option value="bmp">BMP</option>
        <option value="gif">GIF</option>
        <option value="apng">APNG</option>
        <option value="jp2">JPEG 2000</option>
        <option value="jls">JPEG-LS</option>
        <option value="exr">OpenEXR</option>
        <option value="qoi">QOI</option>
        <option value="tga">Targa</option>
      </select>
    </label>

    <label class="field">
      <span>Preset</span>
      <select bind:value={appState.settings.preset} onchange={() => { appState.applyPreset(); appState.persistSettings(); }}>
        <option value="balanced">Balanced</option>
        <option value="quality">High quality</option>
        <option value="small">Small files</option>
        <option value="lossless">Lossless</option>
      </select>
    </label>
  </div>

  <label class="range-field">
    <span>Quality <strong>{appState.settings.quality}</strong></span>
    <input type="range" min="1" max="100" bind:value={appState.settings.quality} oninput={() => appState.persistSettings()} />
    {#if qualityHint}
      <small class="quality-hint">{qualityHint}</small>
    {/if}
  </label>

  {#if encoderWarning}
    <p class="encoder-warning" role="alert">{encoderWarning}</p>
  {/if}

  <div class="toggle-row">
    <label class="toggle">
      <input type="checkbox" bind:checked={appState.settings.metadata} onchange={() => appState.persistSettings()} />
      <span></span>
      <strong>Keep metadata</strong>
    </label>
  </div>

  <label class="field">
    <span>When output exists</span>
    <select bind:value={appState.settings.collisionMode} onchange={() => appState.persistSettings()}>
      <option value="overwrite">Overwrite</option>
      <option value="skip">Skip</option>
      <option value="rename">Rename</option>
    </select>
  </label>
</section>
