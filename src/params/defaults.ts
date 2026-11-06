// 現像パラメータの既定値と範囲（仕様 4.1、計画 Task 3）。純粋関数のみ。
import { HSL_BANDS } from './types';
import type { Aspect, CurvePoint, DevelopParams, HslBand } from './types';

export function defaultParams(): DevelopParams {
  const hsl = {} as Record<HslBand, { h: number; s: number; l: number }>;
  for (const b of HSL_BANDS) hsl[b] = { h: 0, s: 0, l: 0 };
  const wheel = () => ({ hue: 0, sat: 0, lum: 0 });
  return {
    // asShot の temp/tint は表示用に撮影時の値を入れる。0 は「未計算」
    wb: { mode: 'asShot', temp: 0, tint: 0 },
    basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, saturation: 0 },
    curve: {
      parametric: { highlights: 0, lights: 0, darks: 0, shadows: 0, splits: [0.25, 0.5, 0.75] },
      rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]],
    },
    hsl,
    grading: { shadows: wheel(), midtones: wheel(), highlights: wheel(), global: wheel(), blending: 50, balance: 0 },
    crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' },
  };
}

type Range = [min: number, max: number];
const P100: Range = [-100, 100];

function buildRanges(): Record<string, Range> {
  const r: Record<string, Range> = {
    // RAW の絶対色温度（K）。display 画像の相対値は wb.tempRel / wb.tintRel（±100）
    'wb.temp': [2000, 50000],
    'wb.tint': [-150, 150],
    'wb.tempRel': P100,
    'wb.tintRel': P100,
    'basic.exposure': [-5, 5],
    'grading.blending': [0, 100],
    'grading.balance': P100,
    'crop.x': [0, 1], 'crop.y': [0, 1], 'crop.w': [0, 1], 'crop.h': [0, 1],
    'crop.angle': [-45, 45],
  };
  for (const k of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation']) r[`basic.${k}`] = P100;
  for (const k of ['highlights', 'lights', 'darks', 'shadows']) r[`curve.parametric.${k}`] = P100;
  for (const b of HSL_BANDS) for (const k of ['h', 's', 'l']) r[`hsl.${b}.${k}`] = P100;
  for (const w of ['shadows', 'midtones', 'highlights', 'global']) {
    r[`grading.${w}.hue`] = [0, 360];
    r[`grading.${w}.sat`] = [0, 100];
    r[`grading.${w}.lum`] = P100;
  }
  return r;
}

/** スライダー等の範囲。キーは 'basic.exposure' 形式 */
export const RANGES: Readonly<Record<string, Range>> = buildRanges();

/** 範囲に丸める。非有限値（NaN 等）は fallback にする */
export function clampTo(v: number, [lo, hi]: Range, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function rng(key: string): Range {
  const r = RANGES[key];
  if (!r) throw new Error(`unknown range ${key}`);
  return r;
}

const ASPECTS: readonly Aspect[] = ['original', 'free', '1:1', '4:5', '3:2', '16:9'];

function clampCurve(pts: CurvePoint[], fallback: CurvePoint[]): CurvePoint[] {
  if (!Array.isArray(pts) || pts.length < 2) return fallback.map(([x, y]) => [x, y]);
  return pts
    .map(([x, y]): CurvePoint => [clampTo(x, [0, 1], 0), clampTo(y, [0, 1], 0)])
    .sort((a, b) => a[0] - b[0]);
}

/**
 * 画像の種類を知らない状態で WB を丸める。RAW（2000..50000K、0=未計算）と display（±100 相対値）の
 * 両方を壊さないよう、temp は両者の包絡 [-100, 50000]、tint は [-150, 150] に丸める。
 * 種類が分かる場面では clampWb を使う。
 */
const WB_TEMP_HULL: Range = [-100, 50000];

export function clampWb(wb: DevelopParams['wb'], kind: 'raw' | 'display'): DevelopParams['wb'] {
  const mode = wb.mode === 'custom' ? 'custom' : 'asShot';
  if (kind === 'display') {
    return { mode, temp: clampTo(wb.temp, rng('wb.tempRel'), 0), tint: clampTo(wb.tint, rng('wb.tintRel'), 0) };
  }
  // RAW: temp 0 は「未計算」として残す
  const temp = wb.temp === 0 ? 0 : clampTo(wb.temp, rng('wb.temp'), 0);
  return { mode, temp, tint: clampTo(wb.tint, rng('wb.tint'), 0) };
}

/** 全項目を範囲に丸めた新しいオブジェクトを返す（入力は変更しない） */
export function clampParams(p: DevelopParams): DevelopParams {
  const d = defaultParams();
  const c = (key: string, v: number, fb: number) => clampTo(v, rng(key), fb);
  const out = defaultParams();

  out.wb = {
    mode: p.wb.mode === 'custom' ? 'custom' : 'asShot',
    temp: clampTo(p.wb.temp, WB_TEMP_HULL, 0),
    tint: c('wb.tint', p.wb.tint, 0),
  };
  for (const k of Object.keys(d.basic) as (keyof DevelopParams['basic'])[]) {
    out.basic[k] = c(`basic.${k}`, p.basic[k], d.basic[k]);
  }
  const pp = p.curve.parametric;
  for (const k of ['highlights', 'lights', 'darks', 'shadows'] as const) {
    out.curve.parametric[k] = c(`curve.parametric.${k}`, pp[k], 0);
  }
  const s = (Array.isArray(pp.splits) && pp.splits.length === 3 ? pp.splits : d.curve.parametric.splits)
    .map((v, i) => clampTo(v, [0, 1], d.curve.parametric.splits[i] ?? 0))
    .sort((a, b) => a - b);
  out.curve.parametric.splits = [s[0] ?? 0.25, s[1] ?? 0.5, s[2] ?? 0.75];
  for (const ch of ['rgb', 'r', 'g', 'b'] as const) out.curve[ch] = clampCurve(p.curve[ch], d.curve[ch]);
  for (const b of HSL_BANDS) {
    for (const k of ['h', 's', 'l'] as const) out.hsl[b][k] = c(`hsl.${b}.${k}`, p.hsl[b][k], 0);
  }
  for (const w of ['shadows', 'midtones', 'highlights', 'global'] as const) {
    for (const k of ['hue', 'sat', 'lum'] as const) out.grading[w][k] = c(`grading.${w}.${k}`, p.grading[w][k], 0);
  }
  out.grading.blending = c('grading.blending', p.grading.blending, d.grading.blending);
  out.grading.balance = c('grading.balance', p.grading.balance, d.grading.balance);
  for (const k of ['x', 'y', 'w', 'h', 'angle'] as const) out.crop[k] = c(`crop.${k}`, p.crop[k], d.crop[k]);
  out.crop.aspect = ASPECTS.includes(p.crop.aspect) ? p.crop.aspect : 'original';
  return out;
}
