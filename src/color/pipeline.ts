// 参照パイプライン（仕様 3.2 の処理段 1〜11）。WGSL の現像シェーダーはこの関数と最大誤差 1/512 で一致させる。
// 各段の式は tone.ts / hsl.ts / grading.ts / wb.ts / uniforms.ts の先頭コメントを参照。
//  1 WB            RAW: rgb ×= wbMul（カメラ RGB）／ display: rgb = displayWb · rgb（リニア Rec.2020）
//  2 カメラ→Rec.2020（RAW のみ）: c = min(rgb, 1)（クリップ）; w = smoothstep(0.8, 1, min(c))（全チャンネルが飽和に
//                    近い = 白飛び部分ほど 1）; rgb = mix(camToWork·c, Y(camToWork·c)·[1,1,1], w)
//  3 露光          rgb ×= exposureMul
//  4 ハイライト／シャドウ  rgb ×= localToneGain(baseLum, highlights, shadows)
//  5 コントラスト・白・黒  rgb ×= contrastGain(Y(rgb), contrast, whites, blacks)
//  6 ベーストーンマップ    baseToneMap=1 のとき rgb = baseToneMap(rgb)
//  7 自然な彩度・彩度      OKLab 上で vibranceSaturation
//  8 トーンカーブ          e = srgbOetf(rgb)（知覚・ガンマ）; 各チャンネルに tone → rgb → r/g/b の LUT を順に適用
//                          （lutApply(l, x) = sampleLut(l, x) + (x − clamp(x, 0, 1))。範囲外は傾き 1 で延長し、恒等 LUT は厳密に恒等）;
//                          rgb = srgbEotf(e)
//  9 HSL                   OKLab 上で applyHsl
// 10 カラーグレーディング  OKLab 上で applyGrading
// 11 出力                  o = clamp(outMatrix·rgb, 0, 1); outOetf=1 なら srgbOetf(o)。
//                          ディザは 8bit 量子化する側（表示・書き出し）で画素座標から付ける（ここは決定的な値を返す）。
import { linearToOklab, oklabToLinear } from './oklab';
import { apply3, srgbEotf, srgbOetf } from './spaces';
import type { Vec3 } from './spaces';
import { applyGrading } from './grading';
import { applyHsl, vibranceSaturation } from './hsl';
import { sampleLut } from './spline';
import { baseToneMap, contrastGain, localToneGain, luminance2020, smoothstep } from './tone';
import type { Luts, Uniforms } from './uniforms';

export { luminance2020 } from './tone';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function lutApply(lut: Float32Array, x: number): number {
  return sampleLut(lut, x) + (x - clamp01(x));
}

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

/** 処理段 1〜3（WB、カメラ → Rec.2020・ハイライト処理、露光）。ベース層の入力にも使う */
export function linearStages(rgbIn: Vec3, u: Uniforms): Vec3 {
  let rgb: Vec3;
  // 1・2
  if (u.kind === 1) {
    const c: Vec3 = [
      Math.min(rgbIn[0] * u.wbMul[0], 1), Math.min(rgbIn[1] * u.wbMul[1], 1), Math.min(rgbIn[2] * u.wbMul[2], 1),
    ];
    const w = smoothstep(0.8, 1, Math.min(c[0], c[1], c[2]));
    const m = apply3(u.camToWork, c);
    const Y = luminance2020(m);
    rgb = [m[0] + (Y - m[0]) * w, m[1] + (Y - m[1]) * w, m[2] + (Y - m[2]) * w];
  } else {
    rgb = apply3(u.displayWb, rgbIn);
  }
  // 3
  return scale(rgb, u.exposureMul);
}

export function developPixel(rgbIn: Vec3, baseLum: number, u: Uniforms, luts: Luts): Vec3 {
  let rgb = linearStages(rgbIn, u);
  // 4
  rgb = scale(rgb, localToneGain(baseLum, u.highlights, u.shadows));
  // 5
  rgb = scale(rgb, contrastGain(luminance2020(rgb), u.contrast, u.whites, u.blacks));
  // 6
  if (u.baseToneMap === 1) rgb = baseToneMap(rgb);
  // 7
  rgb = oklabToLinear(vibranceSaturation(linearToOklab(rgb), u.vibrance, u.saturation));
  // 8
  const chans = [luts.r, luts.g, luts.b] as const;
  rgb = rgb.map((v, i) => {
    let e = srgbOetf(v);
    e = lutApply(luts.tone, e);
    e = lutApply(luts.rgb, e);
    e = lutApply(chans[i]!, e);
    return srgbEotf(e);
  }) as Vec3;
  // 9・10
  rgb = oklabToLinear(applyGrading(applyHsl(linearToOklab(rgb), u.hsl), u.grading));
  // 11
  const o = apply3(u.outMatrix, rgb);
  return o.map((v) => (u.outOetf === 1 ? srgbOetf(clamp01(v)) : clamp01(v))) as Vec3;
}

// ---- 処理段 4 のベース層（仕様 3.3・3.4、計画 Task 14） ----
// ベース層は作業画像全体（切り抜き前）から 1 枚だけ作り、プレビューと書き出しの全タイルで共有する。
//   大きさ: 長辺 BASE_LAYER_EDGE（作業画像がそれより小さければ作業画像と同じ）。baseLayerSize。
//   入力: 各画素の処理段 1〜3 後の輝度 Y（linearStages → luminance2020）。
//   フィルター: 自己ガイドのガイデッドフィルター（He ら）を log 輝度 I = log2(max(Y, 2^-20)) 上で計算する。
//     半径 r = max(1, round(0.02 · 長辺))、eps = 0.01（log2 の分散。0.1 stop より大きい段差は保つ）。
//     box(·) は (2r+1)² の窓の平均（画像の外は数えない = 有効な画素数で割る。縦横に分けて計算しても同じ値）。
//     μ = box(I), σ² = box(I²) − μ², a = σ²/(σ² + eps), b = μ − a·μ, q = box(a)·I + box(b)
//   出力: リニア輝度 exp2(q)。DevelopPass は入力 UV でこれをバイリニア補間して baseLum として使う。
export const BASE_LAYER_EDGE = 512;
export const BASE_LAYER_EPS = 0.01;
const LOG_FLOOR = -20;

export function baseLayerRadius(w: number, h: number): number {
  return Math.max(1, Math.round(0.02 * Math.max(w, h)));
}

export function baseLayerSize(w: number, h: number): { w: number; h: number } {
  const L = Math.max(w, h);
  if (L <= BASE_LAYER_EDGE) return { w, h };
  const s = BASE_LAYER_EDGE / L;
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** 縦横に分けた box 平均（窓は画像内だけ） */
function boxMean(src: Float64Array, w: number, h: number, r: number): Float64Array {
  const tmp = new Float64Array(w * h);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    let s = 0;
    for (let i = x0; i <= x1; i++) s += src[y * w + i]!;
    tmp[y * w + x] = s / (x1 - x0 + 1);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    let s = 0;
    for (let j = y0; j <= y1; j++) s += tmp[j * w + x]!;
    out[y * w + x] = s / (y1 - y0 + 1);
  }
  return out;
}

/** CPU 参照のベース層（lum はベース層の大きさ w×h のリニア輝度） */
export function baseLayerRef(lum: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const r = baseLayerRadius(w, h);
  const I = new Float64Array(n), II = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.log2(Math.max(lum[i]!, 2 ** LOG_FLOOR));
    I[i] = v;
    II[i] = v * v;
  }
  const mI = boxMean(I, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float64Array(n), b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = mI[i]!;
    const v = Math.max(0, mII[i]! - m * m);
    a[i] = v / (v + BASE_LAYER_EPS);
    b[i] = m - a[i]! * m;
  }
  const mA = boxMean(a, w, h, r), mB = boxMean(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 2 ** (mA[i]! * I[i]! + mB[i]!);
  return out;
}
