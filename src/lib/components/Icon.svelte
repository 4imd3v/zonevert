<script lang="ts">
  // Symbols live once in index.html; this just references them by name.
  let { name }: { name: string } = $props();
</script>

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
