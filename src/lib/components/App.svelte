<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { appState } from "$lib/stores/app-state.svelte";
  import Topbar from "./Topbar.svelte";
  import Workspace from "./Workspace.svelte";
  import RunBar from "./RunBar.svelte";
  import StatusBar from "./StatusBar.svelte";

  onMount(() => {
    // Fire-and-forget init — components read $state fields reactively as it resolves.
    appState.init();

    // Native drag-drop — delivers real file paths (HTML5 ondrop can't in WebView).
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWebviewWindow();
      win.onDragDropEvent((e) => {
        if (e.payload.type === "drop") {
          appState.isDraggingFiles = false;
          appState.addDroppedFiles(e.payload.paths);
        } else {
          // "enter" / "over" / "leave" — highlight the drop affordance.
          appState.isDraggingFiles = e.payload.type !== "leave";
        }
      }).then((fn) => {
        unlisten = fn;
      });
    } catch {
      // Not in Tauri (e.g. plain Vite preview) — drag-drop unavailable, fine.
    }

    return () => {
      unlisten?.();
      appState.destroy();
    };
  });

  // Keyboard shortcuts (ported from renderer.js setupKeyboardShortcuts).
  function onKeydown(event: KeyboardEvent) {
    const ctrl = event.ctrlKey || event.metaKey;
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA";

    if (ctrl && event.shiftKey && event.key === "C") {
      event.preventDefault();
      appState.copyCommand();
      return;
    }
    if (typing) return;

    if (ctrl && event.key === "o") {
      event.preventDefault();
      appState.addFiles();
    } else if (ctrl && event.key === "Enter") {
      event.preventDefault();
      appState.runConversion();
    } else if (event.key === "Escape" && appState.isConverting) {
      event.preventDefault();
      appState.cancelCurrentJob();
    } else if ((event.key === "Delete" || event.key === "Backspace") && appState.selectedFileIndex >= 0) {
      event.preventDefault();
      const idx = appState.selectedFileIndex;
      appState.removeFile(idx);
      // select next or last after removal
      appState.selectedFileIndex = appState.files.length
        ? Math.min(idx, appState.files.length - 1)
        : -1;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="app-shell">
  <Topbar />
  <Workspace />
  <RunBar />
  <StatusBar />
</main>

