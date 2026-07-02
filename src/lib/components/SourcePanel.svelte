<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";
  import { basename, extension } from "$lib/logic/conversion-plan";
  import Icon from "./Icon.svelte";

  let isEmpty = $derived(appState.files.length === 0);
  let countText = $derived(
    appState.files.length === 0
      ? "No files selected"
      : appState.files.length === 1
        ? "1 file selected"
        : `${appState.files.length} files selected`,
  );
</script>

<section class="panel" aria-labelledby="sourceTitle">
  <div class="panel-header">
    <div>
      <h2 id="sourceTitle">Source</h2>
      <p>{countText}</p>
    </div>
    <div class="button-row">
      <button class="icon-button" type="button" aria-label="Add images" title="Add images (Ctrl+O)" onclick={() => appState.addFiles()}>
        <Icon name="plus" />
      </button>
      <button class="icon-button" type="button" aria-label="Clear images" title="Clear images" onclick={() => appState.clearFiles()}>
        <Icon name="trash" />
      </button>
    </div>
  </div>

  <button class="drop-target" type="button" onclick={() => appState.addFiles()}>
    <span class="drop-icon" aria-hidden="true"><Icon name="image" /></span>
    <span class="drop-copy">
      <strong>Choose or drop images</strong>
      <small>JPG, PNG, WebP, AVIF, TIFF, BMP, GIF</small>
    </span>
  </button>

  <div class="file-list" aria-live="polite">
    {#if isEmpty}
      <div class="empty-state">
        <Icon name="alert" />
        <span>Add images to start building the FFmpeg command.</span>
      </div>
    {:else}
      {#each appState.files as file, index (file.path)}
        <div class="file-row">
          <img class="file-thumb" src={appState.thumbnails.get(file.path)} alt="" />
          <div class="file-info">
            <strong>{file.name || basename(file.path)}</strong>
            <span>{extension(file.name || file.path).toUpperCase() || "IMAGE"}</span>
            <span class="file-dimensions">{appState.imageMeta.get(file.path) ?? ""}</span>
          </div>
          <button
            class="icon-button file-remove-button"
            type="button"
            aria-label="Remove {file.name || 'file'}"
            title="Remove"
            onclick={() => appState.removeFile(index)}
          >
            <Icon name="x" />
          </button>
        </div>
      {/each}
    {/if}
  </div>
</section>
