<script lang="ts">
  // 基本補正（仕様 4.1 basic）
  import Slider from './Slider.svelte';

  const ev = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const ITEMS = [
    ['コントラスト', 'contrast'], ['ハイライト', 'highlights'], ['シャドウ', 'shadows'],
    ['白レベル', 'whites'], ['黒レベル', 'blacks'], ['自然な彩度', 'vibrance'], ['彩度', 'saturation'],
  ] as const;
</script>

<div class="basic" data-testid="basic-panel">
  <Slider label="露光量" path="basic.exposure" step={0.01} format={ev} />
  {#each ITEMS as [label, key] (key)}
    <Slider {label} path={`basic.${key}`} step={1} />
  {/each}
</div>
