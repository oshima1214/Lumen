<script lang="ts">
  // カラーグレーディング（仕様 4.1 grading）: シャドウ / 中間調 / ハイライト / 全体 の色相・彩度・輝度、ブレンド、バランス。
  import { useApp } from '../context';
  import Slider from './Slider.svelte';

  type Region = 'shadows' | 'midtones' | 'highlights' | 'global';
  const REGIONS: [Region, string][] = [['shadows', 'シャドウ'], ['midtones', '中間調'], ['highlights', 'ハイライト'], ['global', '全体']];
  const ed = useApp().editor;
  let region = $state<Region>('midtones');
  const deg = (v: number) => `${Math.round(v)}°`;
  /** 選んだ色の見本（彩度 0 は灰色） */
  const swatch = (r: Region) => {
    const g = ed.params.grading[r];
    return `hsl(${g.hue} ${Math.round(g.sat * 0.8)}% ${50 + g.lum * 0.2}%)`;
  };
</script>

<div class="grading" data-testid="grading-panel">
  <div class="regions" role="radiogroup" aria-label="調整する範囲">
    {#each REGIONS as [r, label] (r)}
      <button role="radio" aria-checked={region === r} class:on={region === r} onclick={() => (region = r)}>
        <span class="dot" style:background={swatch(r)}></span>{label}
      </button>
    {/each}
  </div>
  <Slider label="色相" path={`grading.${region}.hue`} step={1} track="hue" format={deg} />
  <Slider label="彩度" path={`grading.${region}.sat`} step={1} />
  <Slider label="輝度" path={`grading.${region}.lum`} step={1} />
  <div class="sep"></div>
  <Slider label="ブレンド" path="grading.blending" step={1} />
  <Slider label="バランス" path="grading.balance" step={1} />
</div>

<style>
  .regions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 4px 12px; }
  .regions button { padding: 0 2px; font-size: 12px; flex-direction: column; gap: 2px; }
  .regions button.on { color: var(--accent); border-color: var(--accent); }
  .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--line); }
  .sep { height: 1px; background: var(--line); margin: 6px 12px; }
</style>
