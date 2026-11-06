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

export function developPixel(rgbIn: Vec3, baseLum: number, u: Uniforms, luts: Luts): Vec3 {
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
  rgb = scale(rgb, u.exposureMul);
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
