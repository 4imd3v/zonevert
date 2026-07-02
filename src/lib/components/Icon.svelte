<script lang="ts">
  // SVG icon symbols shared across the app (ported from old index.html icon-defs).
  // Rendered once here as hidden defs; <svg><use href="#icon-..."/></svg> anywhere
  // in the tree picks them up. Kept global (not scoped) so the symbols resolve.

  let { name }: { name: string } = $props();
</script>

<svg aria-hidden="true" style="display:none">
  <symbol id="icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
  <symbol id="icon-folder" viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /></symbol>
  <symbol id="icon-play" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></symbol>
  <symbol id="icon-stop" viewBox="0 0 24 24"><path d="M7 7h10v10H7z" /></symbol>
  <symbol id="icon-copy" viewBox="0 0 24 24"><path d="M8 8h11v11H8z" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></symbol>
  <symbol id="icon-trash" viewBox="0 0 24 24"><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 15h10l1-15M9 7V4h6v3" /></symbol>
  <symbol id="icon-check" viewBox="0 0 24 24"><path d="m5 12 5 5L20 7" /></symbol>
  <symbol id="icon-alert" viewBox="0 0 24 24"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.3 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /></symbol>
  <symbol id="icon-terminal" viewBox="0 0 24 24"><path d="m5 8 4 4-4 4" /><path d="M12 18h7" /></symbol>
  <symbol id="icon-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></symbol>
  <symbol id="icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></symbol>
  <symbol id="icon-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></symbol>
  <symbol id="icon-image" viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><path d="m3 16 5-5 4 4 2-2 7 7" /><path d="M16 8h.01" /></symbol>
</svg>

<svg class="icon" aria-hidden="true"><use href="#icon-{name}"></use></svg>

<style>
  .icon {
    width: 1em;
    height: 1em;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
