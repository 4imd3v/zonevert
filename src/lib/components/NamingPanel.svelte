<script lang="ts">
  import { appState } from "$lib/stores/app-state.svelte";

  let summary = $derived.by(() => {
    const intent = appState.intent;
    const naming = intent.naming;
    if (naming.sequential) {
      const pad = (n: number) => String(n).padStart(naming.padWidth, "0");
      return `Sequential (${pad(1)}, ${pad(2)}, …).${intent.format}`;
    }
    const parts: string[] = [];
    if (naming.prefix) parts.push(naming.prefix);
    parts.push("name");
    if (naming.suffix) parts.push(naming.suffix);
    else parts.push("(auto)");
    return `${parts.join("")}.${intent.format}`;
  });
</script>

<section class="panel" aria-labelledby="namingTitle">
  <div class="panel-header">
    <div>
      <h2 id="namingTitle">Naming</h2>
      <p>{summary}</p>
    </div>
  </div>

  <div class="field-grid">
    <label class="field">
      <span>Prefix</span>
      <input type="text" spellcheck="false" placeholder="" bind:value={appState.settings.namePrefix} oninput={() => appState.persistSettings()} />
    </label>
    <label class="field">
      <span>Suffix</span>
      <input type="text" spellcheck="false" placeholder="-converted" bind:value={appState.settings.nameSuffix} oninput={() => appState.persistSettings()} />
    </label>
  </div>

  <div class="toggle-row">
    <label class="toggle">
      <input type="checkbox" bind:checked={appState.settings.sequential} onchange={() => appState.persistSettings()} />
      <span></span>
      <strong>Sequential numbers</strong>
    </label>
    <label class="field" style="grid-template-columns: auto 1fr; align-items: center; gap: 7px;">
      <span>Pad</span>
      <input type="number" min="1" max="5" step="1" inputmode="numeric" bind:value={appState.settings.padWidth} disabled={!appState.settings.sequential} onchange={() => appState.persistSettings()} />
    </label>
  </div>
</section>
