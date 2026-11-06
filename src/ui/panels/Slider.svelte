<script lang="ts">
  // 調整スライダー（計画 Task 24）。
  // - ドラッグ（相対移動）の開始で beginGesture、終了で endGesture → 1 回の取り消しで戻る（仕様 4.5）
  // - ダブルクリックで既定値、数値をタップして直接入力（範囲に丸める）、矢印キーで 1 刻み（Shift で 10 刻み）
  // - 値は path（'basic.exposure'）で読み書きする。WB のように変換が要るものは get / set で差し替える
  import { RANGES, defaultParams } from '../../params/defaults';
  import type { DevelopParams } from '../../params/types';
  import { useApp } from '../context';
  import { defaultFormat, getPath, parseNumber, quantize, setPath, trackGradient, type Track } from './slider';

  let {
    label, path, step, track, format,
    range, get, set, resetTo, disabled = false,
  }: {
    label: string;
    path: string;
    step: number;
    track?: Track;
    format?: (v: number) => string;
    /** 既定は RANGES[path] */
    range?: readonly [number, number];
    get?: (p: DevelopParams) => number;
    set?: (p: DevelopParams, v: number) => void;
    /** ダブルクリックで戻す値（既定は defaultParams の値） */
    resetTo?: number;
    disabled?: boolean;
  } = $props();

  const ed = useApp().editor;
  const r = $derived(range ?? RANGES[path] ?? ([-100, 100] as const));
  const value = $derived(get ? get(ed.params) : getPath(ed.params, path));
  const def = $derived(resetTo ?? getPath(defaultParams(), path));
  const text = $derived(format ? format(value) : defaultFormat(value, step, r[0] < 0));
  const pos = $derived((value - r[0]) / (r[1] - r[0] || 1));
  const origin = $derived(Math.min(1, Math.max(0, (def - r[0]) / (r[1] - r[0] || 1))));
  const gradient = $derived(trackGradient(track, path));

  function write(v: number): void {
    if (disabled) return;
    const q = quantize(v, step, r);
    if (q === value) return;
    ed.update((p) => (set ? set(p, q) : setPath(p, path, q)));
  }

  // ---- ドラッグ ----
  let drag: { id: number; x: number; v: number; w: number } | null = null;

  function down(e: PointerEvent): void {
    if (disabled || e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    el.focus();
    drag = { id: e.pointerId, x: e.clientX, v: value, w: Math.max(1, el.getBoundingClientRect().width) };
    ed.beginGesture();
  }
  function move(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    write(drag.v + ((e.clientX - drag.x) / drag.w) * (r[1] - r[0]));
  }
  function up(e: PointerEvent): void {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    ed.endGesture();
  }

  function key(e: KeyboardEvent): void {
    const k = e.key;
    const d = (e.shiftKey ? 10 : 1) * step;
    let v: number | null = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') v = value + d;
    else if (k === 'ArrowLeft' || k === 'ArrowDown') v = value - d;
    else if (k === 'Home') v = r[0];
    else if (k === 'End') v = r[1];
    if (v === null) return;
    e.preventDefault();
    e.stopPropagation(); // ←→ の画像送りにしない
    write(v);
  }

  // ---- 直接入力 ----
  let editing = $state(false);
  let draft = $state('');
  function startEdit(): void {
    if (disabled) return;
    draft = String(value);
    editing = true;
  }
  function commit(): void {
    if (!editing) return;
    editing = false;
    const v = parseNumber(draft);
    if (v !== null) write(v);
  }
  function editKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = false; }
  }
  function focusSelect(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }
</script>

<div class="slider" class:disabled>
  <div class="head">
    <span class="label">{label}</span>
    {#if editing}
      <input
        class="num edit"
        type="text"
        inputmode="decimal"
        aria-label={`${label}を入力`}
        bind:value={draft}
        onkeydown={editKey}
        onblur={commit}
        use:focusSelect
      />
    {:else}
      <button class="num value" aria-label={`${label}の値`} {disabled} onclick={startEdit}>{text}</button>
    {/if}
  </div>
  <div
    class="track"
    class:colored={gradient !== null}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={r[0]}
    aria-valuemax={r[1]}
    aria-valuenow={value}
    aria-valuetext={text}
    aria-disabled={disabled}
    style:background-image={gradient ?? 'linear-gradient(var(--line), var(--line))'}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
    ondblclick={() => write(def)}
  >
    {#if gradient === null}
      <span class="fill" style:left={`${Math.min(origin, pos) * 100}%`} style:width={`${Math.abs(pos - origin) * 100}%`}></span>
    {/if}
    <span class="thumb" style:left={`${pos * 100}%`}></span>
  </div>
</div>

<style>
  .slider { padding: 2px 12px; }
  .slider.disabled { opacity: 0.5; }
  .head { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
  .label { color: var(--text); }
  .value {
    min-height: 24px; min-width: 56px; padding: 0 4px; border-color: transparent; justify-content: flex-end;
    font-variant-numeric: tabular-nums; color: var(--text-sub);
  }
  .edit { width: 72px; height: 24px; text-align: right; padding: 0 4px; font-variant-numeric: tabular-nums; }
  .track {
    position: relative; height: 20px; margin: 0 6px; cursor: ew-resize; touch-action: none;
    background-repeat: no-repeat; background-position: center; background-size: 100% 2px;
  }
  .track.colored { background-size: 100% 4px; }
  .track:focus-visible { outline-offset: 2px; }
  .fill { position: absolute; top: 9px; height: 2px; background: var(--text-sub); }
  .thumb {
    position: absolute; top: 4px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 0 2px var(--panel);
  }
</style>
