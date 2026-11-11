<script lang="ts">
  // 切り抜きパネル（計画 Task 25）: 縦横比、角度、リセット、完了／取り消し。枠そのものはビューアの CropOverlay で動かす。
  import type { Aspect } from '../../params/types';
  import { useApp } from '../context';

  const app = useApp();
  const ASPECTS: [Aspect, string][] = [['original', '元画像'], ['free', '自由'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:2', '3:2'], ['16:9', '16:9']];
  const d = $derived(app.cropDraft);
  const angle = $derived(d?.angle ?? app.editor.params.crop.angle);
  const aspect = $derived(d?.aspect ?? app.editor.params.crop.aspect);

  function setAngle(v: string): void {
    const n = Number(v.replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(n)) app.setCropAngle(Math.round(n * 10) / 10);
  }
</script>

<div class="crop-tool" data-testid="crop-tool">
  {#if !d}
    <button class="primary" onclick={() => app.enterCrop()}>切り抜きを編集（R）</button>
  {:else}
    <div class="row aspects" role="group" aria-label="縦横比">
      {#each ASPECTS as [a, label] (a)}
        <button aria-pressed={aspect === a} class:on={aspect === a} onclick={() => app.setCropAspect(a)}>{label}</button>
      {/each}
    </div>
    <label class="row">
      <span>角度</span>
      <input type="range" min="-45" max="45" step="0.1" value={angle} aria-label="角度スライダー" oninput={(e) => setAngle(e.currentTarget.value)} ondblclick={() => app.setCropAngle(0)} />
      <input class="num" type="number" min="-45" max="45" step="0.1" value={angle} aria-label="角度" onchange={(e) => setAngle(e.currentTarget.value)} />
    </label>
    <div class="row actions">
      <button onclick={() => app.resetCrop()}>リセット</button>
      <button onclick={() => app.cancelCrop()}>取り消し（Esc）</button>
      <button class="primary" onclick={() => app.commitCrop()}>完了（Enter）</button>
    </div>
  {/if}
</div>

<style>
  .crop-tool { display: grid; gap: 8px; padding: 4px 0; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .aspects button { min-width: 44px; }
  .on { border-color: var(--accent); color: var(--accent); }
  input[type='range'] { flex: 1; accent-color: var(--accent); }
  .num { width: 64px; font-variant-numeric: tabular-nums; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 4px; padding: 4px; }
  .primary { background: var(--accent); color: #1c1c1c; border-color: var(--accent); }
</style>
