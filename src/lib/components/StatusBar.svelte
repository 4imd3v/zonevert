<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  const FORMAT_LABELS: Record<string, string> = {
    webp: "WebP", jpg: "JPEG", png: "PNG", avif: "AVIF",
    tiff: "TIFF", bmp: "BMP", gif: "GIF", apng: "APNG",
    jp2: "JPEG 2000", jls: "JPEG-LS", exr: "OpenEXR", qoi: "QOI", tga: "Targa",
  };

  let queueSummary = $derived(appState.queueSummary);
  let formatLabel = $derived(FORMAT_LABELS[appState.settings.format] ?? appState.settings.format.toUpperCase());
  let outputLabel = $derived(appState.outputDir || "Output beside source");
  let ffmpegLabel = $derived(appState.ffmpegVersion || (appState.ffmpegStatus === "ok" ? "FFmpeg ready" : "Checking FFmpeg"));
</script>

<footer class="status-bar" aria-label="Application status">
  <span><strong>{appState.files.length}</strong> files</span>
  <span>{formatLabel} / quality {appState.settings.quality}</span>
  <span title={outputLabel}>{outputLabel}</span>
  <span>{queueSummary.text}</span>
  <span class="status-bar__ffmpeg" title={ffmpegLabel}>
    <span class="status-dot status-dot--{appState.ffmpegStatus}"></span>
    {ffmpegLabel}
  </span>
</footer>
