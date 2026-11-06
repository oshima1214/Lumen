<script lang="ts">
  // HSL（仕様 4.1 hsl）: 色相 / 彩度 / 輝度 を切り替えて 8 色のスライダーを並べる。
  import { HSL_BANDS, type HslBand } from '../../params/types';
  import Slider from './Slider.svelte';

  const NAMES: Record<HslBand, string> = {
    red: 'レッド', orange: 'オレンジ', yellow: 'イエロー', green: 'グリーン',
    aqua: 'アクア', blue: 'ブルー', purple: 'パープル', magenta: 'マゼンタ',
  };
  const MODES = [['h', '色相'], ['s', '彩度'], ['l', '輝度']] as const;
  let mode = $state<'h' | 's' | 'l'>('h');
</script>

<div class="hsl" data-testid="hsl-panel">
  <div class="modes" role="radiogroup" aria-label="HSL の項目">
    {#each MODES as [m, label] (m)}
      <button role="radio" aria-checked={mode === m} class:on={mode === m} onclick={() => (mode = m)}>{label}</button>
    {/each}
  </div>
  {#each HSL_BANDS as band (band)}
    <Slider label={NAMES[band]} path={`hsl.${band}.${mode}`} step={1} track={`hsl-${band}`} />
  {/each}
</div>

<style>
  .modes { display: flex; gap: 2px; padding: 4px 12px; }
  .modes button { flex: 1; }
  .modes button.on { color: var(--accent); border-color: var(--accent); }
</style>
