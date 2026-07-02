<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  const FORMAT_LABELS: Record<string, string> = {
    webp: "WebP", jpg: "JPEG", png: "PNG", avif: "AVIF",
    tiff: "TIFF", bmp: "BMP", gif: "GIF",
  };

  let formatLabel = $derived(FORMAT_LABELS[appState.settings.format] ?? appState.settings.format.toUpperCase());
  let outputLabel = $derived(appState.outputDir ? "Folder" : "Source");
</script>

<section class="summary-strip" aria-label="Conversion summary">
  <div class="summary-item"><span>Files</span><strong>{appState.files.length}</strong></div>
  <div class="summary-item"><span>Format</span><strong>{formatLabel}</strong></div>
  <div class="summary-item"><span>Quality</span><strong>{appState.settings.quality}</strong></div>
  <div class="summary-item"><span>Output</span><strong>{outputLabel}</strong></div>
</section>
