<script lang="ts">
  // iPhone の編集画面（仕様 5.1）: 上に写真（ピンチで拡大・2 本指で移動・長押しで編集前・左右スワイプで画像送り）、
  // 下にツールのタブ。上部に戻る・取り消し・やり直し・共有・メニュー（設定のコピー／貼り付け）。
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Ellipsis from 'lucide-svelte/icons/ellipsis';
  import Redo2 from 'lucide-svelte/icons/redo-2';
  import Share from 'lucide-svelte/icons/share';
  import Undo2 from 'lucide-svelte/icons/undo-2';
  import { DEFAULT_COPY_GROUPS } from '../../params/partial';
  import { useApp } from '../context';
  import CropOverlay from '../panels/CropOverlay.svelte';
  import Histogram from '../panels/Histogram.svelte';
  import { GestureRecognizer } from './gestures';
  import { shareImages } from './share';
  import ToolTabs from './ToolTabs.svelte';

  let { onback }: { onback: () => void } = $props();
  const app = useApp();
  const ed = app.editor;
  let host: HTMLElement;
  let zoom = $state({ s: 1, x: 0, y: 0 });
  let menu = $state(false);
  let busy = $state<string | null>(null);

  // canvas をここに置き、大きさを Editor の view.viewport に伝える
  $effect(() => {
    const canvas = app.canvas;
    canvas.classList.add('lumen-canvas');
    host.prepend(canvas);
    const measure = () => {
      const dpr = devicePixelRatio || 1;
      ed.setView({ viewport: { w: Math.max(1, Math.round(host.clientWidth * dpr)), h: Math.max(1, Math.round(host.clientHeight * dpr)) } });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => { ro.disconnect(); canvas.remove(); };
  });
  // 画像が替わったら拡大を戻す
  $effect(() => { void ed.currentId; zoom = { s: 1, x: 0, y: 0 }; });
  $effect(() => { app.canvas.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`; });

  let pinchBase = 1;
  const rec = new GestureRecognizer((g) => {
    if (app.tool === 'crop') return;                          // 切り抜き中は枠の操作を優先
    switch (g.kind) {
      case 'pinch': zoom = { ...zoom, s: Math.min(8, Math.max(1, pinchBase * g.scale)) }; rec.setZoomed(zoom.s > 1.01); break;
      case 'pan': zoom = { ...zoom, x: zoom.x + g.dx, y: zoom.y + g.dy }; break;
      case 'longPressStart': ed.setView({ before: true }); break;
      case 'longPressEnd': ed.setView({ before: false }); break;
      case 'swipe': void app.step(g.dir === 'left' ? 1 : -1); break;
    }
  });
  function down(e: PointerEvent): void { pinchBase = zoom.s; rec.pointerDown(e); host.setPointerCapture?.(e.pointerId); }
  function up(e: PointerEvent): void { rec.pointerUp(e); if (zoom.s <= 1.01) zoom = { s: 1, x: 0, y: 0 }; }

  async function share(): Promise<void> {
    if (!ed.currentId) return;
    busy = '書き出し中…';
    const r = await shareImages(app, [ed.currentId]);
    busy = r.failed.length ? `書き出せませんでした: ${r.failed[0]!.reason}` : null;
  }
</script>

<div class="editor" data-testid="mobile-editor">
  <header class="top">
    <button aria-label="戻る" title="戻る" onclick={onback}><ArrowLeft size={22} /></button>
    <span class="spacer"></span>
    <button aria-label="取り消し" title="取り消し" disabled={!ed.canUndo} onclick={() => ed.undo()}><Undo2 size={22} /></button>
    <button aria-label="やり直し" title="やり直し" disabled={!ed.canRedo} onclick={() => ed.redo()}><Redo2 size={22} /></button>
    <button aria-label="共有" title="共有" disabled={busy !== null} onclick={share}><Share size={22} /></button>
    <button aria-label="メニュー" title="メニュー" aria-expanded={menu} onclick={() => (menu = !menu)}><Ellipsis size={22} /></button>
  </header>
  {#if menu}
    <div class="menu" role="menu">
      <button role="menuitem" onclick={() => { ed.copy(DEFAULT_COPY_GROUPS); menu = false; }}>設定をコピー</button>
      <button role="menuitem" onclick={async () => { menu = false; if (ed.currentId) await ed.paste([ed.currentId]); }}>設定を貼り付け</button>
      <button role="menuitem" onclick={() => { ed.resetAll(); menu = false; }}>すべてリセット</button>
    </div>
  {/if}
  {#if busy}<p class="busy sub">{busy}</p>{/if}
  <div class="photo" data-testid="mobile-photo" bind:this={host} role="img" aria-label="写真" style:background-color="var(--bg)"
    onpointerdown={down} onpointermove={(e) => rec.pointerMove(e)} onpointerup={up} onpointercancel={up}>
    {#if ed.view.before}<span class="badge">編集前</span>{/if}
    {#if app.tool === 'crop' && ed.working}<CropOverlay canvas={app.canvas} />{/if}
    {#if ed.status.decodeError}<p class="msg danger">この写真を開けません: {ed.status.decodeError}</p>{/if}
  </div>
  <details class="hist"><summary>ヒストグラム</summary><Histogram /></details>
  <ToolTabs />
</div>

<style>
  .editor { height: 100%; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; gap: 2px; padding: env(safe-area-inset-top) 4px 0; background: var(--panel); border-bottom: 1px solid var(--line); }
  .top button { min-width: 44px; min-height: 44px; border-color: transparent; display: grid; place-items: center; }
  .spacer { flex: 1; }
  .menu { position: absolute; right: 8px; top: calc(48px + env(safe-area-inset-top)); z-index: 5; display: grid; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
  .menu button { min-height: 44px; text-align: left; border: 0; padding: 0 16px; }
  .photo { position: relative; flex: 1; min-height: 0; overflow: hidden; display: grid; place-items: center; touch-action: none; }
  .photo :global(.lumen-canvas) { max-width: 100%; max-height: 100%; object-fit: contain; transform-origin: center; }
  .badge { position: absolute; top: 8px; left: 8px; z-index: 2; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 4px; }
  .msg { padding: 16px; text-align: center; }
  .busy { padding: 6px 12px; }
  .hist { background: var(--panel); border-top: 1px solid var(--line); padding: 0 12px; }
  .hist summary { min-height: 32px; display: flex; align-items: center; color: var(--text-sub); }
</style>
