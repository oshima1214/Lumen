<script lang="ts">
  // トーンカーブ（計画 Task 25、仕様 3.2 処理段 8）: RGB / R / G / B のポイントカーブと、パラメトリック 4 領域＋分割点 3 つ。
  // 点の追加はクリック、移動はドラッグ（1 回の取り消しで戻る）、削除はダブルクリック。端点は x を固定する。
  import { monotoneSpline } from '../../color/spline';
  import type { CurvePoint } from '../../params/types';
  import { addPoint, movePoint, removePoint } from '../curve-edit';
  import { useApp } from '../context';
  import Slider from './Slider.svelte';

  const ed = useApp().editor;
  type Ch = 'rgb' | 'r' | 'g' | 'b';
  const CHANNELS: [Ch, string, string][] = [['rgb', 'RGB', 'var(--text)'], ['r', 'R', '#e5484d'], ['g', 'G', '#46a758'], ['b', 'B', '#3e8ef7']];
  let ch = $state<Ch>('rgb');
  const pts = $derived(ed.params.curve[ch]);
  const color = $derived(CHANNELS.find((c) => c[0] === ch)![2]);
  const path = $derived.by(() => {
    const f = monotoneSpline(pts);
    let s = '';
    for (let i = 0; i <= 64; i++) { const x = i / 64; s += `${i ? 'L' : 'M'}${x * 100},${(1 - Math.min(1, Math.max(0, f(x)))) * 100}`; }
    return s;
  });

  let svg: SVGSVGElement;
  let drag: { i: number; id: number } | null = null;
  const toUnit = (e: PointerEvent | MouseEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  };
  const write = (next: CurvePoint[]) => ed.update((p) => { p.curve[ch] = next; });

  function bgDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const [x, y] = toUnit(e);
    const next = addPoint(pts, x, y);
    if (next === pts) return;
    write(next);
  }
  function ptDown(i: number, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag = { i, id: e.pointerId };
    ed.beginGesture();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function ptMove(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    const [x, y] = toUnit(e);
    write(movePoint(pts, drag.i, x, y));
  }
  function ptUp(e: PointerEvent): void {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    ed.endGesture();
  }
  const split = (i: 0 | 1 | 2) => ({
    get: (p: typeof ed.params) => p.curve.parametric.splits[i],
    set: (p: typeof ed.params, v: number) => {
      const s = [...p.curve.parametric.splits] as [number, number, number];
      s[i] = Math.min(i < 2 ? s[i + 1]! - 0.05 : 0.95, Math.max(i > 0 ? s[i - 1]! + 0.05 : 0.05, v));
      p.curve.parametric.splits = s;
    },
  });
  const sp = [split(0), split(1), split(2)] as const;
</script>

<div class="curve" data-testid="curve-editor">
  <div class="tabs" role="tablist" aria-label="チャンネル">
    {#each CHANNELS as [c, label] (c)}
      <button role="tab" aria-selected={ch === c} class:on={ch === c} onclick={() => (ch = c)}>{label}</button>
    {/each}
  </div>
  <svg bind:this={svg} viewBox="-3 -3 106 106" data-testid="curve-svg" role="img" aria-label="トーンカーブ"
    onpointerdown={bgDown} onpointermove={ptMove} onpointerup={ptUp} onpointercancel={ptUp}>
    <rect x="0" y="0" width="100" height="100" class="bg" />
    {#each [25, 50, 75] as g (g)}
      <line x1={g} y1="0" x2={g} y2="100" class="grid" /><line x1="0" y1={g} x2="100" y2={g} class="grid" />
    {/each}
    <line x1="0" y1="100" x2="100" y2="0" class="diag" />
    <path d={path} fill="none" stroke={color} stroke-width="1.2" />
    {#each pts as [x, y], i (i)}
      <circle cx={x * 100} cy={(1 - y) * 100} r="3" class="pt" data-testid="curve-point-{i}" role="presentation"
        onpointerdown={(e) => ptDown(i, e)} ondblclick={(e) => { e.stopPropagation(); write(removePoint(pts, i)); }} />
    {/each}
  </svg>
  <div class="param">
    <Slider label="ハイライト" path="curve.parametric.highlights" step={1} />
    <Slider label="ライト" path="curve.parametric.lights" step={1} />
    <Slider label="ダーク" path="curve.parametric.darks" step={1} />
    <Slider label="シャドウ" path="curve.parametric.shadows" step={1} />
    <Slider label="分割点 1" path="curve.parametric.splits.0" step={0.01} range={[0, 1]} get={sp[0].get} set={sp[0].set} resetTo={0.25} />
    <Slider label="分割点 2" path="curve.parametric.splits.1" step={0.01} range={[0, 1]} get={sp[1].get} set={sp[1].set} resetTo={0.5} />
    <Slider label="分割点 3" path="curve.parametric.splits.2" step={0.01} range={[0, 1]} get={sp[2].get} set={sp[2].set} resetTo={0.75} />
  </div>
</div>

<style>
  .curve { display: grid; gap: 8px; }
  .tabs { display: flex; gap: 4px; }
  .tabs button { min-width: 44px; }
  .on { border-color: var(--accent); color: var(--accent); }
  svg { width: 100%; aspect-ratio: 1; touch-action: none; cursor: crosshair; }
  .bg { fill: var(--bg); stroke: var(--line); stroke-width: 0.5; }
  .grid { stroke: var(--line); stroke-width: 0.4; }
  .diag { stroke: var(--text-sub); stroke-width: 0.3; stroke-dasharray: 1.5 1.5; }
  .pt { fill: var(--panel); stroke: var(--text); stroke-width: 1; cursor: grab; }
</style>
