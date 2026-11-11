<script lang="ts">
  // ホワイトバランス（仕様 4.1 wb）。RAW は K（撮影時の値を初期表示）、JPEG などは ±100 の相対値。
  import { useApp } from '../context';
  import Slider from './Slider.svelte';
  import { setWb, wbSliders, type WbImage } from './wb';

  const ed = useApp().editor;
  const img = $derived<WbImage>(ed.working ?? { kind: 'display' });
  const v = $derived(wbSliders(ed.params.wb, img));
  const signed = (x: number) => (x > 0 ? `+${Math.round(x)}` : `${Math.round(x)}`);
  const kelvin = (x: number) => `${Math.round(x)} K`;

  function preset(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value;
    if (value === 'asShot') ed.update((p) => { p.wb = { mode: 'asShot', temp: 0, tint: 0 }; });
  }
</script>

<div class="wb" data-testid="wb-panel">
  <div class="row">
    <span>ホワイトバランス</span>
    <select aria-label="ホワイトバランス" value={ed.params.wb.mode} onchange={preset} disabled={ed.currentId === null}>
      <option value="asShot">撮影時の設定</option>
      <option value="custom" disabled={ed.params.wb.mode !== 'custom'}>カスタム</option>
    </select>
  </div>
  <Slider
    label="色温度" path="wb.temp" step={v.unit === 'K' ? 50 : 1} track="temp"
    range={v.tempRange} resetTo={v.asShot.temp} format={v.unit === 'K' ? kelvin : signed}
    get={() => v.temp} set={(p, x) => setWb(p, img, 'temp', x)}
  />
  <Slider
    label="色かぶり" path="wb.tint" step={1} track="tint"
    range={v.tintRange} resetTo={v.asShot.tint} format={signed}
    get={() => v.tint} set={(p, x) => setWb(p, img, 'tint', x)}
  />
</div>

<style>
  .row { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; }
  select { height: 28px; padding: 0 4px; }
</style>
