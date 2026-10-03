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
      <h2 id="sourceTitle">Sources</h2>
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

  {#if isEmpty}
    <button
      class="drop-target"
      class:is-dragging={appState.isDraggingFiles}
      type="button"
      onclick={() => appState.addFiles()}
    >
      <span class="drop-icon" aria-hidden="true"><Icon name="image" /></span>
      <span class="drop-copy">
        <strong>Drop images or videos here</strong>
        <small>or click to browse · JPG, PNG, WebP, AVIF, TIFF · MP4, MKV, WebM, MOV, AVI</small>
      </span>
    </button>
  {:else}
    <button
      class="drop-strip"
      class:is-dragging={appState.isDraggingFiles}
      type="button"
      title="Add files (Ctrl+O)"
      onclick={() => appState.addFiles()}
    >
      <Icon name="plus" />
      Add more files
    </button>
  {/if}

  <div class="file-list" class:is-empty={isEmpty} role="listbox" aria-label="Source files" aria-live="polite">
    {#if !isEmpty}
      {#each appState.files as file, index (file.path)}
        {@const meta = appState.imageMeta.get(file.path)}
        {@const isVideo = appState.isVideo(file.path)}
        <div
          class="file-row"
          class:file-row--selected={appState.selectedFileIndex === index}
          class:file-row--draggable={!appState.isConverting}
          role="option"
          aria-selected={appState.selectedFileIndex === index}
          tabindex="0"
          draggable={!appState.isConverting}
          ondragstart={(e) => { e.dataTransfer?.setData("text/plain", String(index)); }}
          ondragover={(e) => { e.preventDefault(); }}
          ondrop={(e) => { e.preventDefault(); const from = Number(e.dataTransfer?.getData("text/plain")); if (!Number.isNaN(from)) appState.reorderFiles(from, index); }}
          onclick={() => { appState.selectedFileIndex = index; }}
          onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); appState.selectedFileIndex = index; } }}
        >
          <img class="file-thumb" src={appState.thumbnails.get(file.path)} alt="" />
          <div class="file-info">
            <strong>{file.name || basename(file.path)}</strong>
            {#if isVideo}
              <span>VIDEO · {appState.videoSummary(file.path)}</span>
            {:else}
              <span>{extension(file.name || file.path).toUpperCase() || "IMAGE"}{meta ? ` · ${meta}` : ""}</span>
            {/if}
          </div>
          <div class="file-row-buttons">
            <button
              class="icon-button file-convert-button"
              type="button"
              aria-label="Convert only {file.name || 'file'}"
              title="Convert this file"
              disabled={appState.isConverting}
              onclick={() => appState.convertSingleFile(index)}
            >
              <Icon name="play" />
            </button>
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
        </div>
      {/each}
    {/if}
  </div>
</section>
