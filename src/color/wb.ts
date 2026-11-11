// ホワイトバランス（仕様 3.2 処理段 1）。CPU 側（buildUniforms）でだけ使う。GPU には結果の倍率・行列だけを渡す。
//
// 色温度 → xy: Planck 軌跡の近似（Kim ら 2002 の 3 次式、1667–25000K。範囲外は端で飽和）。
// 色かぶり tint: 軌跡の法線方向の Duv（CIE 1960 uv 上の符号付き距離）。tint 1 = Duv 0.0001。
//   符号: tint 正 = 光源が軌跡より緑側（Duv 正）。その光源を中性にするので画像はマゼンタ側へ動く。
//   （Lightroom と同じ向き: スライダー正 = マゼンタ。昼光・蛍光灯の光源は tint 正になる。D65 ≈ 6504K / tint +32）
//   法線は軌跡の接線（T の中心差分）を時計回りに 90° 回した単位ベクトル（+v 側 = 緑側）。
// xy → 色温度・色かぶり: uv 上で軌跡までの距離が最小になる mired を、1 mired 刻みの走査＋黄金分割で探す。
//
// RAW: 指定の光源 (cct, tint) の XYZ を camToXyz の逆行列でカメラ RGB の中性点にし、その逆数を倍率にする（G=1）。
// display: 撮影時を D65 とみなした相対補正。relTemp ±100 = ±100 mired（正 = 光源を寒色側＝ mired を下げた光源とみなして
//   D65 へ Bradford 変換 → 画像は暖色に）、relTint ±100 = 光源の Duv ±0.01（正 = 光源を緑側とみなす → 画像はマゼンタ）。
//   relTemp=relTint=0 は厳密に単位行列。
import { D65_XY, REC2020_TO_XYZ, XYZ_TO_REC2020, IDENTITY3, apply3, inv3, mul3, xyToXyz } from './spaces';
import type { Mat3, Vec3, Xy } from './spaces';

export { D65_XY } from './spaces';

export const CCT_MIN = 1667;
export const CCT_MAX = 25000;
/** tint 1 あたりの Duv */
export const TINT_DUV = 0.0001;

const clampT = (t: number) => Math.min(CCT_MAX, Math.max(CCT_MIN, t));

/** Kim らの近似による Planck 軌跡上の xy */
export function planckXy(cct: number): Xy {
  const T = clampT(cct);
  const t1 = 1e3 / T, t2 = 1e6 / (T * T), t3 = 1e9 / (T * T * T);
  const x = T <= 4000
    ? -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t1 + 0.17991
    : -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.24039;
  const x2 = x * x, x3 = x2 * x;
  const y = T <= 2222
    ? -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
    : T <= 4000
      ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

function xyToUv([x, y]: Xy): Xy {
  const d = -2 * x + 12 * y + 3;
  return [(4 * x) / d, (6 * y) / d];
}

function uvToXy([u, v]: Xy): Xy {
  const d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

/** 軌跡上の uv と、緑側を向く単位法線 */
function locusFrame(cct: number): { p: Xy; n: Xy } {
  const T = clampT(cct);
  const a = xyToUv(planckXy(Math.max(CCT_MIN, T - 1)));
  const b = xyToUv(planckXy(Math.min(CCT_MAX, T + 1)));
  const du = b[0] - a[0], dv = b[1] - a[1];
  const len = Math.hypot(du, dv);
  // T が増えると u は減る。接線 (du, dv) を時計回りに 90° 回した (dv, -du) は +v（緑）側を向く
  return { p: xyToUv(planckXy(T)), n: [dv / len, -du / len] };
}

export function cctTintToXy(cct: number, tint: number): Xy {
  const { p, n } = locusFrame(cct);
  const duv = tint * TINT_DUV;
  return uvToXy([p[0] + n[0] * duv, p[1] + n[1] * duv]);
}

export function xyToCctTint(x: number, y: number): { cct: number; tint: number } {
  const q = xyToUv([x, y]);
  const dist = (mired: number) => {
    const p = xyToUv(planckXy(1e6 / mired));
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  };
  const mLo = 1e6 / CCT_MAX, mHi = 1e6 / CCT_MIN;
  let best = mLo, bestD = Infinity;
  for (let m = mLo; m <= mHi; m += 1) {
    const d = dist(m);
    if (d < bestD) { bestD = d; best = m; }
  }
  let lo = Math.max(mLo, best - 1), hi = Math.min(mHi, best + 1);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
    if (dist(m1) < dist(m2)) hi = m2; else lo = m1;
  }
  const cct = 1e6 / ((lo + hi) / 2);
  const { p, n } = locusFrame(cct);
  const duv = (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1];
  return { cct, tint: duv / TINT_DUV };
}

function xyOfXyz([X, Y, Z]: Vec3): Xy {
  const s = X + Y + Z;
  return [X / s, Y / s];
}

/** 光源 (cct, tint) を中性にするカメラ RGB の倍率（G=1 に正規化） */
export function rawWbMultipliers(camToXyz: Mat3, cct: number, tint: number): Vec3 {
  const cam = apply3(inv3(camToXyz), xyToXyz(cctTintToXy(cct, tint)));
  return [cam[1] / cam[0], 1, cam[1] / cam[2]];
}

/** 撮影時の中性点（カメラ RGB）から色温度・色かぶりを求める */
export function asShotCctTint(camToXyz: Mat3, neutral: Vec3): { cct: number; tint: number } {
  const [x, y] = xyOfXyz(apply3(camToXyz, neutral));
  return xyToCctTint(x, y);
}

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV: Mat3 = inv3(BRADFORD);

/** XYZ 空間の色順応行列（fromXy の白を toXy の白へ写す） */
export function bradford(fromXy: Xy, toXy: Xy): Mat3 {
  const s = apply3(BRADFORD, xyToXyz(fromXy));
  const d = apply3(BRADFORD, xyToXyz(toXy));
  const D: Mat3 = [d[0] / s[0], 0, 0, 0, d[1] / s[1], 0, 0, 0, d[2] / s[2]];
  return mul3(BRADFORD_INV, mul3(D, BRADFORD));
}

const D65_CT = xyToCctTint(D65_XY[0], D65_XY[1]);

/** display 画像の相対 WB（リニア Rec.2020 → リニア Rec.2020） */
export function displayWbMatrix(relTemp: number, relTint: number): Mat3 {
  if (relTemp === 0 && relTint === 0) return [...IDENTITY3];
  const mired = Math.min(1e6 / CCT_MIN, Math.max(1e6 / CCT_MAX, 1e6 / D65_CT.cct - relTemp));
  // 軌跡上の移動量を D65 に足す（相対値 0 の近くで D65 から連続に動かす）
  const a = cctTintToXy(1e6 / mired, D65_CT.tint + relTint);
  const b = cctTintToXy(D65_CT.cct, D65_CT.tint);
  const src: Xy = [D65_XY[0] + a[0] - b[0], D65_XY[1] + a[1] - b[1]];
  return mul3(XYZ_TO_REC2020, mul3(bradford(src, D65_XY), REC2020_TO_XYZ));
}
