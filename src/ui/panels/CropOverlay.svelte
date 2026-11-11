<script lang="ts">
  // 切り抜き枠（計画 Task 25）。ビューアの canvas の表示範囲に重ね、枠の移動と四隅の取っ手での大きさ変更を行う。
  // 座標は回転フレーム上の正規化座標（0..1）。縦横比が固定のときは比率を保つ。Enter で確定、Esc で取り消し。
  import { aspectValue, orientedSize } from '../../engine/geometry';
  import { useApp } from '../context';

  let { canvas }: { canvas: HTMLCanvasElement } = $props();
  const app = useApp();
  const ed = app.editor;

  /** canvas の中で画像が描かれている範囲（object-fit: contain）を親要素基準の CSS px で */
  let area = $state({ x: 0, y: 0, w: 1, h: 1 });
  $effect(() => {
    const update = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const pr = parent.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      const s = Math.min(cr.width / Math.max(1, canvas.width), cr.height / Math.max(1, canvas.height));
      const w = canvas.width * s, h = canvas.height * s;
      area = { x: cr.left - pr.left + (cr.width - w) / 2, y: cr.top - pr.top + (cr.height - h) / 2, w, h };
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    const id = setInterval(update, 200);       // canvas の画素数は描画のたびに変わる
    return () => { ro.disconnect(); clearInterval(id); };
  });

  const d = $derived(app.cropDraft);
  type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se';
  let drag: { mode: Mode; id: number; x: number; y: number; start: NonNullable<typeof d> } | null = null;

  function down(mode: Mode, e: PointerEvent): void {
    if (!d || e.button !== 0) return;
    e.stopPropagation();
    drag = { mode, id: e.pointerId, x: e.clientX, y: e.clientY, start: { ...d } };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId || !ed.working) return;
    const s = drag.start;
    const dx = (e.clientX - drag.x) / area.w, dy = (e.clientY - drag.y) / area.h;
    if (drag.mode === 'move') { app.setCropDraft({ ...s, x: s.x + dx, y: s.y + dy }); return; }
    const o = orientedSize(ed.working.fullWidth, ed.working.fullHeight, ed.working.orientation);
    const left = drag.mode.endsWith('w'), top = drag.mode.startsWith('n');
    let w = Math.max(0.02, s.w + (left ? -dx : dx)), h = Math.max(0.02, s.h + (top ? -dy : dy));
    const r = aspectValue(s.aspect, o.w, o.h);
    if (r !== null) h = (w * o.w) / (r * o.h);
    const x = left ? s.x + s.w - w : s.x, y = top ? s.y + s.h - h : s.y;
    app.setCropDraft({ ...s, x, y, w, h });
  }
  function up(e: PointerEvent): void { if (drag?.id === e.pointerId) drag = null; }

  function key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Enter') { e.preventDefault(); app.commitCrop(); }
    else if (e.key === 'Escape') { e.preventDefault(); app.cancelCrop(); }
  }
</script>

<svelte:window onkeydown={key} />

{#if d}
  <div class="overlay" data-testid="crop-overlay" role="application" aria-label="切り抜き枠" style:left="{area.x}px" style:top="{area.y}px" style:width="{area.w}px" style:height="{area.h}px"
    onpointermove={move} onpointerup={up} onpointercancel={up}>
    <div class="mask" style:left="0" style:top="0" style:width="100%" style:height="{d.y * 100}%"></div>
    <div class="mask" style:left="0" style:top="{(d.y + d.h) * 100}%" style:width="100%" style:bottom="0"></div>
    <div class="mask" style:left="0" style:top="{d.y * 100}%" style:width="{d.x * 100}%" style:height="{d.h * 100}%"></div>
    <div class="mask" style:left="{(d.x + d.w) * 100}%" style:top="{d.y * 100}%" style:right="0" style:height="{d.h * 100}%"></div>
    <div class="frame" role="presentation" style:left="{d.x * 100}%" style:top="{d.y * 100}%" style:width="{d.w * 100}%" style:height="{d.h * 100}%"
      onpointerdown={(e) => down('move', e)}>
      <div class="grid"></div>
      {#each ['nw', 'ne', 'sw', 'se'] as const as m (m)}
        <div class="handle {m}" data-testid="crop-handle-{m}" role="presentation" onpointerdown={(e) => down(m, e)}></div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .overlay { position: absolute; touch-action: none; }
  .mask { position: absolute; background: rgba(0, 0, 0, 0.55); pointer-events: none; }
  .frame { position: absolute; border: 1px solid var(--text); box-sizing: border-box; cursor: move; }
  .grid {
    position: absolute; inset: 0; pointer-events: none;
    background:
      linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) 33.33%, transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) 66.66%, transparent calc(66.66% + 0.5px)),
      linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255,255,255,0.35) 33.33%, transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255,255,255,0.35) 66.66%, transparent calc(66.66% + 0.5px));
  }
  .handle { position: absolute; width: 22px; height: 22px; border: 3px solid var(--accent); box-sizing: border-box; }
  .nw { left: -4px; top: -4px; border-right: 0; border-bottom: 0; cursor: nwse-resize; }
  .ne { right: -4px; top: -4px; border-left: 0; border-bottom: 0; cursor: nesw-resize; }
  .sw { left: -4px; bottom: -4px; border-right: 0; border-top: 0; cursor: nesw-resize; }
  .se { right: -4px; bottom: -4px; border-left: 0; border-top: 0; cursor: nwse-resize; }
</style>
