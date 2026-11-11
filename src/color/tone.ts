// トーン（仕様 3.2 処理段 4・5・6 と、処理段 8 のパラメトリックカーブ）。
// 輝度 Y はリニア Rec.2020 の輝度（0.2627 R + 0.6780 G + 0.0593 B）。G = 0.18（18% グレー）を中心にする。
// smoothstep(e0, e1, x) は WGSL と同じ: t = clamp((x-e0)/(e1-e0), 0, 1); t·t·(3-2t)。
//
// 処理段 4 ハイライト／シャドウ（localToneGain、h = highlights/100, s = shadows/100）:
//   L = log2(max(B, 2^-20) / 0.18)            （B = ベース層の輝度 baseLum）
//   Δ = 2·h·smoothstep(-1, 2, L) + 2·s·(1 - smoothstep(-4, 0, L))     [stop]
//   rgb ×= exp2(Δ)
//   → highlights は B ≥ 0.09 だけに効き（B < 0.05 は厳密に不変）、最大 ±2 stop。
//     shadows は B < 0.18 だけに効き、B ≤ 0.011 で最大 ±2 stop。
//
// 処理段 5 コントラスト・白レベル・黒レベル（contrastGain、c/w/b = 値/100）。輝度の log2 上で調整し、RGB は同じ倍率:
//   x = log2(max(Y, 1e-10) / 0.18)
//   d = 1.5·c·tanh(x / 2.5)                          （0.6·c·2.5: 18% グレーでの傾き 1+0.6c、遠方で ±1.5 stop に飽和）
//     + 0.75·w·smoothstep(0, 2.5, x)                  （白: Y ≥ 0.18 の明部、Y ≥ 1.0 で最大 ±0.75 stop）
//     + 1.5·b·(1 - smoothstep(-6, -1.5, x))           （黒: Y < 0.064 の暗部、Y ≤ 0.0028 で最大 ±1.5 stop）
//   rgb ×= exp2(d)    （d は有界なので Y → 0 でも倍率は有界。全 0 で厳密に 1）
//   c,w,b ∈ [-1,1] のどの組み合わせでも出力輝度は x について単調（傾き 1 + d'(x) > 0）。
//
// 処理段 6 ベーストーンマップ（baseToneMap、RAW のみ。display は恒等）: 輝度ベースの拡張 Reinhard（白点 4）
//   Yp = max(Y, 1e-10); Yc = min(Yp, 4); f = Yc(1 + Yc/16)/(1 + Yc); rgb ×= f / Yp
//   最大成分 m が 1 を超えたら灰色 f へ寄せる: t = clamp((m-1)/max(m-f, 1e-6), 0, 1); rgb = mix(rgb, f, t)
//
// 処理段 8 パラメトリックカーブ（parametricCurve、CPU で LUT に焼く）:
//   区切り k0=0, k1..k3=splits, k4=1。領域 j=[k_j, k_{j+1}]（shadows, darks, lights, highlights）の中心 c_j、半幅 hw_j。
//   D_j = 0.6·a_j·hw_j（a_j = 値/100）。制御点: (0,0), (c_j, c_j + D_j), (k_j, k_j + (D_{j-1} + D_j)/2)（j=1..3）, (1,1)。
//   y を [0,1] に丸め、前の点 + 1e-6 未満にならないよう補正して単調にし、Fritsch–Carlson で補間する。
import { monotoneSpline } from './spline';
import type { Vec3 } from './spaces';
import type { DevelopParams } from '../params/types';

export const MID_GRAY = 0.18;
export const LUMA_2020: Vec3 = [0.2627, 0.678, 0.0593];

export function luminance2020(rgb: Vec3): number {
  return LUMA_2020[0] * rgb[0] + LUMA_2020[1] * rgb[1] + LUMA_2020[2] * rgb[2];
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 処理段 4 の倍率（h, s は −1..1） */
export function localToneGain(baseLum: number, h: number, s: number): number {
  const L = Math.log2(Math.max(baseLum, 2 ** -20) / MID_GRAY);
  const d = 2 * h * smoothstep(-1, 2, L) + 2 * s * (1 - smoothstep(-4, 0, L));
  return 2 ** d;
}

/** 処理段 5 の倍率（c, w, b は −1..1） */
export function contrastGain(Y: number, c: number, w: number, b: number): number {
  const x = Math.log2(Math.max(Y, 1e-10) / MID_GRAY);
  const d = 1.5 * c * Math.tanh(x / 2.5) + 0.75 * w * smoothstep(0, 2.5, x) + 1.5 * b * (1 - smoothstep(-6, -1.5, x));
  return 2 ** d;
}

/** 処理段 6（RAW のみ） */
export function baseToneMap(rgb: Vec3): Vec3 {
  const Yp = Math.max(luminance2020(rgb), 1e-10);
  const Yc = Math.min(Yp, 4);
  const f = (Yc * (1 + Yc / 16)) / (1 + Yc);
  const k = f / Yp;
  const r = rgb[0] * k, g = rgb[1] * k, b = rgb[2] * k;
  const m = Math.max(r, g, b);
  const t = Math.min(1, Math.max(0, (m - 1) / Math.max(m - f, 1e-6)));
  return [r + (f - r) * t, g + (f - g) * t, b + (f - b) * t];
}

export function parametricCurve(p: DevelopParams['curve']['parametric']): (x: number) => number {
  const k = [0, p.splits[0], p.splits[1], p.splits[2], 1];
  const a = [p.shadows, p.darks, p.lights, p.highlights].map((v) => v / 100);
  if (a.every((v) => v === 0)) return (x) => x;
  const D = a.map((v, j) => 0.6 * v * (k[j + 1]! - k[j]!) / 2);
  const pts: [number, number][] = [[0, 0]];
  for (let j = 0; j < 4; j++) {
    if (j > 0) pts.push([k[j]!, k[j]! + (D[j - 1]! + D[j]!) / 2]);
    const c = (k[j]! + k[j + 1]!) / 2;
    pts.push([c, c + D[j]!]);
  }
  pts.push([1, 1]);
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i]!, prev = pts[i - 1]!;
    pt[1] = Math.min(1, Math.max(prev[1] + (i === pts.length - 1 ? 0 : 1e-6), pt[1]));
  }
  return monotoneSpline(pts);
}
