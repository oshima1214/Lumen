// カラーグレーディング（仕様 3.2 処理段 10）。OKLab 上で計算する。lab = [L, a, b]。
// g（長さ 14）: シャドウ・中間調・ハイライト・グローバルの順に [σ·cos θ, σ·sin θ, λ]、続いて blending, balance。
//   θ = 色相（OKLCh の度 → rad）、σ = sat/100（0..1）、λ = lum/100（−1..1）、blending = 値/100（0..1）、balance = 値/100（−1..1）。
//
//   t = pow(max(L, 1e-6), exp2(−balance))         （balance 正でハイライト側が広がる）
//   half = 0.1 + 0.4·blending                       （領域の境目の幅。0 で狭く、1 で大きく重なる）
//   wS = 1 − smoothstep(1/3 − half, 1/3 + half, t)
//   wH = smoothstep(2/3 − half, 2/3 + half, t)
//   wM = 1 − wS − wH                                （常に ≥ 0）、グローバルは重み 1
//   fade = min(1, 3·max(L, 0))                      （黒付近では色を足さない）
//   (a, b) += Σ w_k·(σcos, σsin)_k · 0.1 · fade     （σ = 1 で OKLab の彩度 0.1）
//   L = max(0, L + Σ w_k·λ_k·0.1)
import { smoothstep } from './tone';
import type { Vec3 } from './spaces';

export const GRADING_CHROMA = 0.1;
export const GRADING_LUM = 0.1;

export function gradingWeights(L: number, blending: number, balance: number): [number, number, number] {
  const t = Math.pow(Math.max(L, 1e-6), 2 ** -balance);
  const half = 0.1 + 0.4 * blending;
  const wS = 1 - smoothstep(1 / 3 - half, 1 / 3 + half, t);
  const wH = smoothstep(2 / 3 - half, 2 / 3 + half, t);
  return [wS, 1 - wS - wH, wH];
}

export function applyGrading(lab: Vec3, g: Float32Array): Vec3 {
  const [L, a, b] = lab;
  const [wS, wM, wH] = gradingWeights(L, g[12]!, g[13]!);
  const w = [wS, wM, wH, 1];
  const fade = Math.min(1, 3 * Math.max(L, 0));
  let da = 0, db = 0, dL = 0;
  for (let k = 0; k < 4; k++) {
    da += w[k]! * g[k * 3]!;
    db += w[k]! * g[k * 3 + 1]!;
    dL += w[k]! * g[k * 3 + 2]!;
  }
  return [Math.max(0, L + dL * GRADING_LUM), a + da * GRADING_CHROMA * fade, b + db * GRADING_CHROMA * fade];
}
