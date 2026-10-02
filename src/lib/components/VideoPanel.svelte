<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  const PROFILES = [
    { value: "mp4-h264", label: "MP4 · H.264 (universal)" },
    { value: "webm-vp9", label: "WebM · VP9 (web)" },
    { value: "mp4-hevc", label: "MP4 · HEVC (compact)" },
  ];
  const CRF_MAX: Record<string, number> = {
    "mp4-h264": 51,
    "webm-vp9": 63,
    "mp4-hevc": 51,
  };

  let crfMax = $derived(CRF_MAX[appState.settings.videoProfile] ?? 51);
  let warnings = $derived(appState.videoWarnings);
</script>

<section class="panel" aria-labelledby="videoTitle">
  <div class="panel-header">
    <div>
      <h2 id="videoTitle">Video</h2>
      <p>Applies to videos in the queue · images use the Output tab</p>
    </div>
  </div>

  <div class="field-grid">
    <label class="field">
      <span>Profile</span>
      <select bind:value={appState.settings.videoProfile} onchange={() => appState.persistSettings()}>
        {#each PROFILES as p (p.value)}
          <option value={p.value}>{p.label}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Resolution</span>
      <select bind:value={appState.settings.videoResolution} onchange={() => appState.persistSettings()}>
        <option value="source">Source</option>
        <option value="1080p">1080p</option>
        <option value="720p">720p</option>
        <option value="480p">480p</option>
      </select>
    </label>

    <label class="field">
      <span>Frame rate</span>
      <select bind:value={appState.settings.videoFps} onchange={() => appState.persistSettings()}>
        <option value="source">Source</option>
        <option value="24">24 fps</option>
        <option value="30">30 fps</option>
        <option value="60">60 fps</option>
      </select>
    </label>
  </div>

  <label class="range-field">
    <span>Quality (CRF) <strong>{appState.settings.videoCrf}</strong></span>
    <input type="range" min="0" max={crfMax} bind:value={appState.settings.videoCrf} oninput={() => appState.persistSettings()} />
    <small class="quality-hint">Lower = better quality, larger file · 0–{crfMax} for this profile</small>
  </label>

  {#if warnings.length}
    {#each warnings as warning}
      <p class="encoder-warning" role="alert">{warning}</p>
    {/each}
  {/if}
</section>
