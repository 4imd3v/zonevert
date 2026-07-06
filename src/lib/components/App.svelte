<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { appState } from "$lib/stores/app-state.svelte";
  import Topbar from "./Topbar.svelte";
  import Workspace from "./Workspace.svelte";
  import StatusBar from "./StatusBar.svelte";

  onMount(() => {
    // Fire-and-forget init — components read $state fields reactively as it resolves.
    appState.init();

    // Native drag-drop — delivers real file paths (HTML5 ondrop can't in WebView).
    let unlisten: (() => void) | undefined;
    try {
      const win = getCurrentWebviewWindow();
      win.onDragDropEvent((e) => {
        if (e.payload.type !== "drop") return;
        appState.addDroppedFiles(e.payload.paths);
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
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="app-shell">
  <Topbar />
  <Workspace />
  <StatusBar />
</main>

