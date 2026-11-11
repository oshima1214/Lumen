<script lang="ts">
  // ヒストグラム（仕様 5.1 / 5.2）: 最後に描いたプレビューの R・G・B を重ねて表示し、白飛び・黒つぶれを警告する。
  // 編集のたびに少し待ってから（描画が終わった後で）Renderer.histogram() を読む。
  import type { Histogram } from '../../engine/renderer';
  import { useApp } from '../context';

  const app = useApp();
  const ed = app.editor;
  const W = 256, H = 96;
  let canvas: HTMLCanvasElement;
  let clip = $state({ high: 0, low: 0 });
  let total = $state(1);

  function draw(h: Histogram): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    let max = 1;
    for (const ch of [h.r, h.g, h.b]) for (let i = 1; i < 255; i++) max = Math.max(max, ch[i] ?? 0);
    ctx.globalCompositeOperation = 'lighter';
    const colors: [Uint32Array, string][] = [[h.r, 'rgba(230, 80, 80, 0.75)'], [h.g, 'rgba(80, 200, 100, 0.75)'], [h.b, 'rgba(80, 130, 240, 0.75)']];
    for (const [ch, color] of colors) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo(i, H - Math.min(1, (ch[i] ?? 0) / max) * (H - 2));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    let n = 0;
    for (let i = 0; i < 256; i++) n += h.g[i] ?? 0;
    total = Math.max(1, n);
    clip = { high: h.clipHigh, low: h.clipLow };
  }

  // 編集・画像・表示が変わったら、描画の後でヒストグラムを読み直す
  $effect(() => {
    void ed.params; void ed.working; void ed.view.before; void ed.view.viewport; void ed.view.mode;
    if (!ed.working || !canvas) return;
    let alive = true;
    const t = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!alive) return;
        void app.renderer.histogram().then((h) => { if (alive) draw(h); }, () => {});
      }));
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  });

  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
</script>

<div class="histogram" data-testid="histogram">
  <canvas bind:this={canvas} width={W} height={H} aria-label="ヒストグラム"></canvas>
  <span class="warn low" class:on={clip.low > 0} title={`黒つぶれ ${pct(clip.low)}`} aria-label={`黒つぶれ ${clip.low > 0 ? 'あり' : 'なし'}`}></span>
  <span class="warn high" class:on={clip.high > 0} title={`白飛び ${pct(clip.high)}`} aria-label={`白飛び ${clip.high > 0 ? 'あり' : 'なし'}`}></span>
</div>

<style>
  .histogram { position: relative; padding: 8px 12px; border-bottom: 1px solid var(--line); }
  canvas { width: 100%; height: 96px; display: block; background: var(--bg); border-radius: 4px; }
  .warn { position: absolute; top: 12px; width: 10px; height: 10px; border: 1px solid var(--text-sub); border-radius: 2px; }
  .warn.low { left: 16px; }
  .warn.high { right: 16px; }
  .warn.low.on { background: #3f6fe0; border-color: #3f6fe0; }
  .warn.high.on { background: #ffffff; border-color: #ffffff; }
</style>
