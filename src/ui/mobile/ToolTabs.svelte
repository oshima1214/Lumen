<script lang="ts">
  // iPhone の編集ツール（仕様 5.1）: 下のタブと、その上の選択中のタブの調整項目。パネル部品は PC 画面と共通。
  import { BUILTIN_PRESETS } from '../../params/presets';
  import type { Preset } from '../../params/types';
  import { useApp } from '../context';
  import BasicPanel from '../panels/BasicPanel.svelte';
  import CropTool from '../panels/CropTool.svelte';
  import CurveEditor from '../panels/CurveEditor.svelte';
  import GradingPanel from '../panels/GradingPanel.svelte';
  import HslPanel from '../panels/HslPanel.svelte';
  import WbPanel from '../panels/WbPanel.svelte';

  const app = useApp();
  const ed = app.editor;
  export const TABS = ['ライト', 'カラー', 'カーブ', 'HSL', 'グレーディング', '切り抜き', 'プリセット'] as const;
  type Tab = (typeof TABS)[number];
  let tab = $state<Tab>('ライト');

  function choose(t: Tab): void {
    if (tab === '切り抜き' && t !== '切り抜き' && app.tool === 'crop') app.commitCrop();
    tab = t;
    if (t === '切り抜き' && app.tool !== 'crop') app.enterCrop();
  }

  let userPresets = $state<Preset[]>([]);
  $effect(() => {
    if (tab !== 'プリセット') return;
    app.backend.presets.list().then((l) => (userPresets = l)).catch(() => (userPresets = []));
  });
</script>

<div class="tools">
  <div class="panel" data-testid="mobile-panel">
    {#if tab === 'ライト'}<BasicPanel />
    {:else if tab === 'カラー'}<WbPanel />
    {:else if tab === 'カーブ'}<CurveEditor />
    {:else if tab === 'HSL'}<HslPanel />
    {:else if tab === 'グレーディング'}<GradingPanel />
    {:else if tab === '切り抜き'}<CropTool />
    {:else}
      <ul class="presets">
        {#each [...BUILTIN_PRESETS, ...userPresets] as p (p.name + p.builtin)}
          <li><button onclick={() => ed.applyPreset(p)}>{p.name}</button></li>
        {/each}
      </ul>
    {/if}
  </div>
  <nav class="tabs" data-testid="tool-tabs" aria-label="ツール">
    {#each TABS as t (t)}
      <button class:active={tab === t} aria-pressed={tab === t} onclick={() => choose(t)}>{t}</button>
    {/each}
  </nav>
</div>

<style>
  .tools { display: flex; flex-direction: column; min-height: 0; }
  .panel { max-height: 38vh; overflow-y: auto; padding: 4px 12px; background: var(--panel); border-top: 1px solid var(--line); }
  .tabs {
    display: flex; overflow-x: auto; gap: 2px; padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    background: var(--panel); border-top: 1px solid var(--line);
  }
  .tabs button { border-color: transparent; white-space: nowrap; flex: none; min-height: 44px; min-width: 44px; }
  .tabs .active { color: var(--accent); }
  .presets { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .presets button { width: 100%; min-height: 44px; }
</style>
