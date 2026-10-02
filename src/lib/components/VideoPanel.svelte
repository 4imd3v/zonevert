<script lang="ts">
  import { onMount } from "svelte";
  import { appState } from "$lib/stores/app-state.svelte";
  import Icon from "./Icon.svelte";

  const PROFILES = [
    { value: "mp4-h264", label: "MP4 · H.264 (universal)" },
    { value: "webm-vp9", label: "WebM · VP9 (web)" },
    { value: "mp4-hevc", label: "MP4 · HEVC (compact)" },
    { value: "gif", label: "GIF (animated image, no audio)" },
    { value: "webp-anim", label: "WebP (animated, no audio)" },
  ];
  const CRF_MAX: Record<string, number> = {
    "mp4-h264": 51,
    "webm-vp9": 63,
    "mp4-hevc": 51,
    gif: 63,
    "webp-anim": 63,
  };
  const QUALITY_HINT: Record<string, string> = {
    "mp4-h264": "Lower = better quality, larger file · 0–51 for this profile",
    "webm-vp9": "Lower = better quality, larger file · 0–63 for this profile",
    "mp4-hevc": "Lower = better quality, larger file · 0–51 for this profile",
    gif: "Dithering quality — lower = finer detail, larger file · GIF caps source at 12 fps / 480px",
    "webp-anim": "Lower = more compression, smaller files (worse quality) · maps to WebP's 0–100 scale, default ≈ 78",
  };
  const HW_LABEL: Record<string, string> = {
    ready: "ready",
    failed: "failed validation",
    pending: "not verified",
    absent: "not in this FFmpeg build",
  };

  let crfMax = $derived(CRF_MAX[appState.settings.videoProfile] ?? 51);
  let warnings = $derived(appState.videoWarnings);
  let estimate = $derived(appState.videoEstimate);
  let hwStatus = $derived(appState.videoHardwareStatus);
  let folderText = $derived(appState.outputDir || "Same folder as each source");

  // Validate this profile's hardware encoders once when the tab opens (1s
  // lavfi encode each; cached for the session).
  onMount(() => {
    appState.ensureVideoEncoders();
  });

  // Re-sample the size estimate whenever anything that affects it changes —
  // profile, quality, resolution, fps, encoder, output dir, file set.
  $effect(() => {
    void appState.settings.videoProfile;
    void appState.settings.videoResolution;
    void appState.settings.videoFps;
    void appState.settings.videoCrf;
    void appState.settings.videoEncoder;
    void appState.outputDir;
    void appState.files.length;
    void appState.videoFiles;
    appState.scheduleVideoEstimate();
  });
</script>

<section class="panel" aria-labelledby="videoTitle">
  <div class="panel-header">
    <div>
      <h2 id="videoTitle">Video</h2>
      <p>{folderText}</p>
    </div>
    <button class="icon-button" type="button" aria-label="Choose output folder" title="Choose output folder" onclick={() => appState.pickOutputDir()}>
      <Icon name="folder" />
    </button>
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

    <label class="field">
      <span>Encoder</span>
      <select bind:value={appState.settings.videoEncoder} onchange={() => appState.persistSettings()}>
        <option value="auto">Automatic (hardware if ready)</option>
        <option value="cpu">CPU only</option>
      </select>
    </label>
  </div>

  <label class="range-field">
    <span>Quality (CRF) <strong>{appState.settings.videoCrf}</strong></span>
    <input type="range" min="0" max={crfMax} bind:value={appState.settings.videoCrf} oninput={() => appState.persistSettings()} />
    <small class="quality-hint">{QUALITY_HINT[appState.settings.videoProfile] ?? ""}</small>
  </label>

  {#if hwStatus.length}
    <ul class="encoder-status">
      {#each hwStatus as hw (hw.name)}
        <li><span class="encoder-dot encoder-dot--{hw.status}" aria-hidden="true"></span>{hw.name} — {HW_LABEL[hw.status]}</li>
      {/each}
    </ul>
  {/if}

  {#if estimate}
    <p class="encoder-estimate">Estimated output: ≈ {estimate} for the first video in the queue · at comparable quality</p>
  {/if}

  {#if warnings.length}
    {#each warnings as warning}
      <p class="encoder-warning" role="alert">{warning}</p>
    {/each}
  {/if}
</section>
