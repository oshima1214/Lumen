// OKLCh 上の色調整（仕様 3.2 処理段 7「自然な彩度・彩度」と処理段 9「HSL」）。lab = [L, a, b]（OKLab）。
// C = √(a²+b²)、hue = atan2(b, a)。smoothstep は WGSL と同じ定義（tone.ts）。
//
// 8 色域の中心（OKLab の色相、度）: 赤 25, オレンジ 55, 黄 105, 緑 142, 水色 195, 青 264, 紫 294, マゼンタ 328
//   （sRGB の原色・二次色の OKLab 色相: 赤 29, 黄 110, 緑 142, シアン 195, 青 264, マゼンタ 328 を基準に、
//    オレンジは肌色 47〜52° を含むよう 55°、紫は青とマゼンタの間）
// 色域の重み hslBandWeights(h): バンド i について d = wrap(h − c_i)（−π..π）、
//   w_i = 1 − smoothstep(0, 1, d ≥ 0 ? d / (c_{i+1} − c_i) : −d / (c_i − c_{i−1}))  （間隔は 2π で折り返し）
//   隣り合う 2 バンドだけが 0 でなく、合計は常に 1、中間で 0.5 ずつ、中心で 1（C¹ 連続）。
//
// 処理段 7（vibranceSaturation、v = vibrance/100、s = saturation/100）:
//   skin = smoothstep(cos 25°, 1, cos(hue − 50°))      （cos(hue − 50°) = (a·cos50° + b·sin50°) / max(C, 1e-8)、atan2 不要）
//   vEff = v − 0.6·skin·max(v, 0)                       （正の自然な彩度は肌色で 4 割に抑える）
//   kv = 1 + vEff·(1 − smoothstep(0, 0.2, C))          （低彩度ほど強く効く）
//   (a, b) ×= max(0, (1 + s)·kv)
//
// 処理段 9（applyHsl、各バンドの h,s,l は値/100）:
//   w = hslBandWeights(hue); dh = Σ w_i h_i; ds = Σ w_i s_i; dl = Σ w_i l_i
//   θ = dh·π/6（最大 ±30°）; (a, b) = rot(θ)·(a, b)·max(0, 1 + ds)
//   L ×= 1 + 0.3·dl·smoothstep(0, 0.04, C)              （無彩色には効かない）
import { smoothstep } from './tone';
import type { Vec3 } from './spaces';

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

export const HSL_CENTERS_DEG: readonly number[] = [25, 55, 105, 142, 195, 264, 294, 328];
export const HSL_CENTERS_RAD: readonly number[] = HSL_CENTERS_DEG.map((d) => d * DEG);

const wrapPos = (x: number) => x - TAU * Math.floor(x / TAU);
/** 中心 i から次の中心までの角度 */
export const HSL_SPAN_NEXT: readonly number[] = HSL_CENTERS_RAD.map((c, i) => wrapPos(HSL_CENTERS_RAD[(i + 1) % 8]! - c));
/** 前の中心から中心 i までの角度 */
export const HSL_SPAN_PREV: readonly number[] = HSL_CENTERS_RAD.map((c, i) => wrapPos(c - HSL_CENTERS_RAD[(i + 7) % 8]!));

export function hslBandWeights(hueRad: number): Float32Array {
  const w = new Float32Array(8);
  for (let i = 0; i < 8; i++) {
    const x = hueRad - HSL_CENTERS_RAD[i]!;
    const d = x - TAU * Math.floor(x / TAU + 0.5);
    const t = d >= 0 ? d / HSL_SPAN_NEXT[i]! : -d / HSL_SPAN_PREV[i]!;
    w[i] = 1 - smoothstep(0, 1, t);
  }
  return w;
}

const SKIN_COS = Math.cos(50 * DEG), SKIN_SIN = Math.sin(50 * DEG), SKIN_EDGE = Math.cos(25 * DEG);

export function vibranceSaturation(lab: Vec3, v: number, s: number): Vec3 {
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  const cosd = (a * SKIN_COS + b * SKIN_SIN) / Math.max(C, 1e-8);
  const skin = smoothstep(SKIN_EDGE, 1, cosd);
  const vEff = v - 0.6 * skin * Math.max(v, 0);
  const kv = 1 + vEff * (1 - smoothstep(0, 0.2, C));
  const k = Math.max(0, (1 + s) * kv);
  return [L, a * k, b * k];
}

/** hsl: 長さ 24（HSL_BANDS の順に h, s, l。値/100） */
export function applyHsl(lab: Vec3, hsl: Float32Array): Vec3 {
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  const w = hslBandWeights(Math.atan2(b, a));
  let dh = 0, ds = 0, dl = 0;
  for (let i = 0; i < 8; i++) {
    const wi = w[i]!;
    dh += wi * hsl[i * 3]!;
    ds += wi * hsl[i * 3 + 1]!;
    dl += wi * hsl[i * 3 + 2]!;
  }
  const th = dh * (Math.PI / 6);
  const cs = Math.cos(th), sn = Math.sin(th);
  const k = Math.max(0, 1 + ds);
  return [L * (1 + 0.3 * dl * smoothstep(0, 0.04, C)), (a * cs - b * sn) * k, (a * sn + b * cs) * k];
}
