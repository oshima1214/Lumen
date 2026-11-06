// スライダーの純粋な補助関数（パスでの読み書き、刻みへの丸め、表示形式、トラックの色）。
import type { HslBand } from '../../params/types';

export type Track = 'temp' | 'tint' | 'hue' | `hsl-${HslBand}`;

export function getPath(obj: unknown, path: string): number {
  let cur: unknown = obj;
  for (const k of path.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[k];
  return typeof cur === 'number' ? cur : 0;
}

export function setPath(obj: unknown, path: string, v: number): void {
  const keys = path.split('.');
  const last = keys.pop();
  let cur = obj as Record<string, unknown>;
  for (const k of keys) cur = cur[k] as Record<string, unknown>;
  if (last !== undefined) cur[last] = v;
}

export function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** 範囲に丸め、刻みに揃える（浮動小数の誤差を残さない） */
export function quantize(v: number, step: number, [lo, hi]: readonly [number, number]): number {
  const c = Math.min(hi, Math.max(lo, v));
  const q = Math.round(c / step) * step;
  return Number(Math.min(hi, Math.max(lo, q)).toFixed(decimalsOf(step)));
}

/** 既定の表示: 刻みの桁数、範囲が負を含めば正の値に + を付ける */
export function defaultFormat(v: number, step: number, signed: boolean): string {
  const s = v.toFixed(decimalsOf(step));
  return signed && v > 0 ? `+${s}` : s === '-0' ? '0' : s;
}

/** 直接入力の解釈（全角数字・全角マイナス・単位付きも受ける）。数でなければ null */
export function parseNumber(text: string): number | null {
  const t = text
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー－]/g, '-')
    .replace(/[^\d.+-]/g, '');
  if (t === '' || t === '-' || t === '+') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** HSL の各色の代表色（UI 表示用の sRGB。色相の並びは params の HSL_BANDS と同じ） */
export const BAND_COLORS: Record<HslBand, string> = {
  red: '#e0473e', orange: '#e58b2e', yellow: '#e2cf3c', green: '#4fb04a',
  aqua: '#3fbfc2', blue: '#3f6fe0', purple: '#8250d4', magenta: '#d4459f',
};
const BAND_ORDER: HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

/**
 * トラックの背景（仕様 5.2: 色温度 青→黄、色かぶり 緑→マゼンタ、HSL の各色）。
 * HSL は path の末尾で使い分ける: .h = 隣の色 → その色 → 隣の色、.s = 灰 → その色、.l = 黒 → その色 → 白。
 */
export function trackGradient(track: Track | undefined, path: string): string | null {
  if (track === 'temp') return 'linear-gradient(to right, #3f6fd8, #9a9a9a, #e0bb2c)';
  if (track === 'tint') return 'linear-gradient(to right, #3fae4a, #9a9a9a, #c844c0)';
  if (track === 'hue') return 'linear-gradient(to right, #e0473e, #e2cf3c, #4fb04a, #3fbfc2, #3f6fe0, #d4459f, #e0473e)';
  if (track?.startsWith('hsl-')) {
    const band = track.slice(4) as HslBand;
    const i = BAND_ORDER.indexOf(band);
    const c = BAND_COLORS[band];
    if (path.endsWith('.s')) return `linear-gradient(to right, #808080, ${c})`;
    if (path.endsWith('.l')) return `linear-gradient(to right, #101010, ${c}, #f0f0f0)`;
    const prev = BAND_COLORS[BAND_ORDER[(i + 7) % 8]!], next = BAND_COLORS[BAND_ORDER[(i + 1) % 8]!];
    return `linear-gradient(to right, ${prev}, ${c}, ${next})`;
  }
  return null;
}
