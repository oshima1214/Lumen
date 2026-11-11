// OKLab（Björn Ottosson）。リニア Rec.2020 を直接入出力する。
//   LMS = M1_XYZ · REC2020_TO_XYZ · rgb、lms' = cbrt(LMS)、Lab = M2 · lms'
// M1_XYZ は Ottosson が公開した XYZ(D65) → LMS 行列。合成した行列 REC2020_TO_LMS（行を正規化）を使う。
// cbrt は WGSL では sign(x)·pow(|x|, 1/3) で書く（負の LMS も対称に扱う）。
import { REC2020_TO_XYZ, apply3, inv3, mul3 } from './spaces';
import type { Mat3, Vec3 } from './spaces';

const XYZ_TO_LMS: Mat3 = [
  0.8189330101, 0.3618667424, -0.1288597137,
  0.0329845436, 0.9293118715, 0.0361456387,
  0.0482003018, 0.2643662691, 0.633851707,
];
export const LMS_TO_OKLAB: Mat3 = [
  0.2104542553, 0.793617785, -0.0040720468,
  1.9779984951, -2.428592205, 0.4505937099,
  0.0259040371, 0.7827717662, -0.808675766,
];
// 各行を正規化し、Rec.2020 の白 [1,1,1] が LMS [1,1,1]（= L 1, a 0, b 0）に厳密に写るようにする
// （元の行列との差は 1e-4 程度。灰色が OKLab 経由でも灰色のまま往復するため）
function normalizeRows(m: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    const row = m.slice(r * 3, r * 3 + 3);
    const s = row.reduce((a, b) => a + b, 0);
    out.push(...row.map((v) => v / s));
  }
  return out;
}
export const REC2020_TO_LMS: Mat3 = normalizeRows(mul3(XYZ_TO_LMS, REC2020_TO_XYZ));
export const LMS_TO_REC2020: Mat3 = inv3(REC2020_TO_LMS);
export const OKLAB_TO_LMS: Mat3 = inv3(LMS_TO_OKLAB);

export function linearToOklab(rgb2020: Vec3): Vec3 {
  const [l, m, s] = apply3(REC2020_TO_LMS, rgb2020);
  return apply3(LMS_TO_OKLAB, [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]);
}

export function oklabToLinear(lab: Vec3): Vec3 {
  const [l, m, s] = apply3(OKLAB_TO_LMS, lab);
  return apply3(LMS_TO_REC2020, [l * l * l, m * m * m, s * s * s]);
}
