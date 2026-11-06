// CPU 側でパラメータを GPU 用の数値と LUT に変換する（計画 Task 7）。
// Uniforms の数値はすべてシェーダーでそのまま使える形（/100 で正規化済み、行列は合成済み）。
//
// RAW（kind=1）:
//   光源 xy: wb.mode='custom' かつ temp > 0 なら cctTintToXy(temp, tint)（camToXyz の逆でカメラ中性点 n を求める）、
//            それ以外は asShotNeutral を n とし、光源 xy = xy(camToXyz·n)。asShotNeutral が無ければ D65。
//   wbMul = (1/n) を最小成分が 1 になるよう正規化（全チャンネルが WB 後の 1.0 で飽和 = クリップ値 1）。
//   camToWork = s · XYZ_TO_REC2020 · Bradford(光源 → D65) · camToXyz · diag(1/wbMul)
//            （s は camToWork·[1,1,1] の輝度を 1 にする係数。WB 後の白 [1,1,1] が作業空間の白 1 になる）
//   displayWb = 単位行列、baseToneMap = 1。camToXyz が無ければ REC2020_TO_XYZ とみなす。
// display（kind=0）:
//   wbMul = [1,1,1]、camToWork = 単位行列、
//   displayWb = wb.mode='custom' なら displayWbMatrix(temp, tint)（±100 の相対値）、asShot なら単位行列。baseToneMap = 0。
// 出力: outMatrix = XYZ_TO_{SRGB|P3} · REC2020_TO_XYZ、outOetf = 1（sRGB / P3 とも sRGB の伝達関数）。
//
// packUniforms のレイアウト（f32 の添字。WGSL では vec4<f32> の配列として読む。行列は 3 本の vec4 = 行（w は 0））:
//    0 kind            1 exposureMul      2 baseToneMap      3 outOetf
//    4..6 wbMul (xyz)  7 0
//    8..19  camToWork 行 0..2（各 vec4: m[r][0], m[r][1], m[r][2], 0）
//   20..31  displayWb 行 0..2
//   32..43  outMatrix 行 0..2
//   44 contrast       45 whites          46 blacks          47 highlights
//   48 shadows        49 vibrance        50 saturation      51 0
//   52..83  hsl: HSL_BANDS の順に 8 × vec4(h, s, l, 0)
//   84..99  grading: シャドウ・中間調・ハイライト・グローバルの順に 4 × vec4(σcosθ, σsinθ, λ, 0)
//  100 blending      101 balance        102 0              103 0
//   合計 UNIFORM_FLOATS = 104 floats = 416 bytes（16 byte の倍数）
import { clampParams } from '../params/defaults';
import { HSL_BANDS } from '../params/types';
import type { DevelopParams } from '../params/types';
import {
  D65_XY, IDENTITY3, REC2020_TO_XYZ, XYZ_TO_P3, XYZ_TO_REC2020, XYZ_TO_SRGB, apply3, inv3, mul3, xyToXyz,
} from './spaces';
import type { Mat3, Vec3, Xy } from './spaces';
import { bradford, cctTintToXy, displayWbMatrix } from './wb';
import { bakeLut, monotoneSpline } from './spline';
import { luminance2020, parametricCurve } from './tone';

export interface ImageColorInfo { kind: 'raw' | 'display'; camToXyz?: Mat3; asShotNeutral?: Vec3 }

export interface Uniforms {
  /** 1 = raw, 0 = display */
  kind: 0 | 1;
  wbMul: Vec3;
  camToWork: Mat3;
  displayWb: Mat3;
  exposureMul: number;
  contrast: number; whites: number; blacks: number; highlights: number; shadows: number;
  vibrance: number; saturation: number;
  baseToneMap: 0 | 1;
  /** 8 × (h, s, l)、各 値/100 */
  hsl: Float32Array;
  /** 4 × (σcosθ, σsinθ, λ) + blending, balance（長さ 14） */
  grading: Float32Array;
  outMatrix: Mat3;
  outOetf: 0 | 1;
}

export interface Luts { tone: Float32Array; rgb: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array }

export type OutputSpace = 'srgb' | 'p3';

export const UNIFORM_FLOATS = 104;

function xyOf([X, Y, Z]: Vec3): Xy {
  const s = X + Y + Z;
  return [X / s, Y / s];
}

function rawColor(p: DevelopParams, img: ImageColorInfo): { wbMul: Vec3; camToWork: Mat3 } {
  const cam = img.camToXyz ?? REC2020_TO_XYZ;
  const camInv = inv3(cam);
  let illum: Xy;
  let n: Vec3;
  if (p.wb.mode === 'custom' && p.wb.temp > 0) {
    illum = cctTintToXy(Math.min(50000, Math.max(2000, p.wb.temp)), Math.min(150, Math.max(-150, p.wb.tint)));
    n = apply3(camInv, xyToXyz(illum));
  } else {
    n = img.asShotNeutral ?? apply3(camInv, xyToXyz(D65_XY));
    illum = xyOf(apply3(cam, n));
  }
  const inv: Vec3 = [1 / n[0], 1 / n[1], 1 / n[2]];
  const lo = Math.min(...inv);
  const wbMul: Vec3 = [inv[0] / lo, inv[1] / lo, inv[2] / lo];
  const unbalance: Mat3 = [1 / wbMul[0], 0, 0, 0, 1 / wbMul[1], 0, 0, 0, 1 / wbMul[2]];
  const m = mul3(XYZ_TO_REC2020, mul3(bradford(illum, D65_XY), mul3(cam, unbalance)));
  const s = 1 / luminance2020(apply3(m, [1, 1, 1]));
  return { wbMul, camToWork: m.map((v) => v * s) };
}

export function buildUniforms(params: DevelopParams, img: ImageColorInfo, out: OutputSpace): { u: Uniforms; luts: Luts } {
  const p = clampParams(params);
  const raw = img.kind === 'raw';
  const color = raw ? rawColor(p, img) : { wbMul: [1, 1, 1] as Vec3, camToWork: [...IDENTITY3] };
  const displayWb = !raw && p.wb.mode === 'custom'
    ? displayWbMatrix(Math.min(100, Math.max(-100, p.wb.temp)), Math.min(100, Math.max(-100, p.wb.tint)))
    : [...IDENTITY3];

  const hsl = new Float32Array(24);
  HSL_BANDS.forEach((band, i) => {
    hsl[i * 3] = p.hsl[band].h / 100;
    hsl[i * 3 + 1] = p.hsl[band].s / 100;
    hsl[i * 3 + 2] = p.hsl[band].l / 100;
  });
  const grading = new Float32Array(14);
  (['shadows', 'midtones', 'highlights', 'global'] as const).forEach((k, i) => {
    const w = p.grading[k];
    const th = (w.hue * Math.PI) / 180;
    grading[i * 3] = (w.sat / 100) * Math.cos(th);
    grading[i * 3 + 1] = (w.sat / 100) * Math.sin(th);
    grading[i * 3 + 2] = w.lum / 100;
  });
  grading[12] = p.grading.blending / 100;
  grading[13] = p.grading.balance / 100;

  const b = p.basic;
  const u: Uniforms = {
    kind: raw ? 1 : 0,
    wbMul: color.wbMul,
    camToWork: color.camToWork,
    displayWb,
    exposureMul: 2 ** b.exposure,
    contrast: b.contrast / 100, whites: b.whites / 100, blacks: b.blacks / 100,
    highlights: b.highlights / 100, shadows: b.shadows / 100,
    vibrance: b.vibrance / 100, saturation: b.saturation / 100,
    baseToneMap: raw ? 1 : 0,
    hsl, grading,
    outMatrix: mul3(out === 'p3' ? XYZ_TO_P3 : XYZ_TO_SRGB, REC2020_TO_XYZ),
    outOetf: 1,
  };
  const luts: Luts = {
    tone: bakeLut(parametricCurve(p.curve.parametric)),
    rgb: bakeLut(monotoneSpline(p.curve.rgb)),
    r: bakeLut(monotoneSpline(p.curve.r)),
    g: bakeLut(monotoneSpline(p.curve.g)),
    b: bakeLut(monotoneSpline(p.curve.b)),
  };
  return { u, luts };
}

export function packUniforms(u: Uniforms): Float32Array {
  const f = new Float32Array(UNIFORM_FLOATS);
  f.set([u.kind, u.exposureMul, u.baseToneMap, u.outOetf], 0);
  f.set([u.wbMul[0], u.wbMul[1], u.wbMul[2], 0], 4);
  const mat = (m: Mat3, at: number) => {
    for (let r = 0; r < 3; r++) f.set([m[r * 3]!, m[r * 3 + 1]!, m[r * 3 + 2]!, 0], at + r * 4);
  };
  mat(u.camToWork, 8);
  mat(u.displayWb, 20);
  mat(u.outMatrix, 32);
  f.set([u.contrast, u.whites, u.blacks, u.highlights], 44);
  f.set([u.shadows, u.vibrance, u.saturation, 0], 48);
  for (let i = 0; i < 8; i++) f.set([u.hsl[i * 3]!, u.hsl[i * 3 + 1]!, u.hsl[i * 3 + 2]!, 0], 52 + i * 4);
  for (let i = 0; i < 4; i++) f.set([u.grading[i * 3]!, u.grading[i * 3 + 1]!, u.grading[i * 3 + 2]!, 0], 84 + i * 4);
  f.set([u.grading[12]!, u.grading[13]!, 0, 0], 100);
  return f;
}
