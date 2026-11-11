<script lang="ts">
  import { untrack } from 'svelte';
  // 中央のビューア（仕様 5.1）。App の canvas をここに置き、大きさの変化を Editor の view.viewport（デバイスピクセル）へ伝える。
  // 画面に合わせる／100%（ダブルクリックでも切り替え）、100% ではドラッグで移動、写真の周囲の背景を 3 種から選ぶ。
  import { orientedSize } from '../../engine/geometry';
  import type { ViewState } from '../../engine/renderer';
  import { useApp } from '../context';
  import CropOverlay from '../panels/CropOverlay.svelte';

  const app = useApp();
  const ed = app.editor;

  const BACKGROUNDS: { value: ViewState['background']; label: string; color: string }[] = [
    { value: 'black', label: '黒', color: '#000000' },
    { value: 'dark', label: 'ダークグレー', color: 'var(--bg)' },
    { value: 'gray18', label: '18% グレー', color: 'var(--gray18)' },
  ];
  const bgColor = $derived(BACKGROUNDS.find((b) => b.value === ed.view.background)?.color ?? 'var(--bg)');
  const showCanvas = $derived(ed.working !== null && ed.status.decodeError === null);

  let host: HTMLElement;

  // canvas を置き、大きさを監視する
  $effect(() => {
    const canvas = app.canvas;
    canvas.classList.add('lumen-canvas');
    host.prepend(canvas);
    // untrack: この $effect が ed.view に依存すると、表示状態が変わるたびに canvas を付け直してしまう
    const measure = () => untrack(() => {
      const dpr = devicePixelRatio || 1;
      const w = Math.max(1, Math.round(host.clientWidth * dpr)), h = Math.max(1, Math.round(host.clientHeight * dpr));
      const v = ed.view.viewport;
      if (v.w !== w || v.h !== h) ed.setView({ viewport: { w, h } });
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => { ro.disconnect(); canvas.remove(); };
  });

  // ---- 100% 表示のドラッグ移動 ----
  let drag: { id: number; x: number; y: number } | null = null;

  /** 切り抜き後のフル解像度の大きさ（100% では 1 画素 = 1 デバイスピクセル） */
  function fullCropped(): { w: number; h: number } | null {
    const img = ed.working;
    if (!img) return null;
    const o = orientedSize(img.fullWidth, img.fullHeight, img.orientation);
    return { w: Math.max(1, o.w * ed.params.crop.w), h: Math.max(1, o.h * ed.params.crop.h) };
  }

  function down(e: PointerEvent): void {
    if (ed.view.mode !== '100' || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    host.setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    const size = fullCropped();
    const dpr = devicePixelRatio || 1;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!size) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    ed.setView({ cx: clamp(ed.view.cx - (dx * dpr) / size.w), cy: clamp(ed.view.cy - (dy * dpr) / size.h) });
  }
  function up(e: PointerEvent): void {
    if (drag?.id === e.pointerId) drag = null;
  }

  function setMode(mode: ViewState['mode']): void {
    ed.setView(mode === 'fit' ? { mode } : { mode, cx: ed.view.cx, cy: ed.view.cy });
  }

  /** ダブルクリック: 100% ならクリックした位置を中心に、fit ならそのまま戻す */
  function dbl(e: MouseEvent): void {
    if (app.tool === 'crop') return;
    if (ed.view.mode === '100') { setMode('fit'); return; }
    const r = app.canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / Math.max(1, r.width), cy = (e.clientY - r.top) / Math.max(1, r.height);
    const inside = cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1;
    ed.setView({ mode: '100', cx: inside ? cx : 0.5, cy: inside ? cy : 0.5 });
  }
</script>

<section class="viewer-wrap">
  <div class="toolbar">
    <div class="group" role="group" aria-label="表示倍率">
      <button aria-pressed={ed.view.mode === 'fit'} onclick={() => setMode('fit')}>画面に合わせる</button>
      <button aria-pressed={ed.view.mode === '100'} onclick={() => setMode('100')}>100%</button>
    </div>
    <span class="spacer"></span>
    {#if ed.view.before}<span class="badge">編集前</span>{/if}
    <div class="group" role="radiogroup" aria-label="背景">
      {#each BACKGROUNDS as b (b.value)}
        <button
          class="swatch"
          role="radio"
          aria-checked={ed.view.background === b.value}
          aria-label={b.label}
          title={b.label}
          onclick={() => ed.setView({ background: b.value })}
        ><span style:background={b.color}></span></button>
      {/each}
    </div>
  </div>
  <div
    class="viewer"
    class:pan={ed.view.mode === '100'}
    class:hidden={!showCanvas}
    bind:this={host}
    data-testid="viewer"
    style:background-color={bgColor}
    role="img"
    aria-label="写真"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    ondblclick={dbl}
  >
    {#if app.tool === 'crop' && showCanvas}
      <CropOverlay canvas={app.canvas} />
    {/if}
    {#if ed.status.decodeError}
      <p class="msg danger">この写真を開けません: {ed.status.decodeError}</p>
    {:else if ed.currentId !== null && ed.working === null}
      <p class="msg sub">読み込み中…</p>
    {:else if ed.currentId === null && !app.loading}
      <p class="msg sub">左の「{app.backend.kind === 'folder' ? 'フォルダを開く' : '写真を取り込む'}」から写真を開いてください</p>
    {/if}
  </div>
</section>

<style>
  .viewer-wrap { height: 100%; display: flex; flex-direction: column; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .group { display: flex; gap: 2px; }
  .spacer { flex: 1; }
  .badge { color: var(--accent); font-size: 12px; }
  .swatch { padding: 0; min-width: var(--tap); border-color: transparent; }
  .swatch span { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--text-sub); display: block; }
  .swatch[aria-checked="true"] span { border: 2px solid var(--accent); }
  .viewer { flex: 1; min-height: 0; position: relative; overflow: hidden; display: grid; place-items: center; touch-action: none; }
  .viewer.pan { cursor: grab; }
  .viewer :global(canvas.lumen-canvas) { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; }
  .viewer.hidden :global(canvas.lumen-canvas) { visibility: hidden; }
  .msg { position: relative; margin: 0; padding: 16px; text-align: center; }
</style>
