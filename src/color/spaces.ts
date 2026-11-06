// 色空間の行列と伝達関数。行列は行優先 9 要素で、列ベクトルに左から掛ける（v' = M v）。
// 各 RGB → XYZ 行列は原色の xy と白色点 D65 (0.3127, 0.3290) から算出する（RGB=[1,1,1] → Y=1 の D65）。
//   Rec.2020: R(0.708, 0.292) G(0.170, 0.797) B(0.131, 0.046)
//   sRGB    : R(0.640, 0.330) G(0.300, 0.600) B(0.150, 0.060)
//   Display P3: R(0.680, 0.320) G(0.265, 0.690) B(0.150, 0.060)
// 伝達関数は sRGB の区分関数（Display P3 も同じ）。負の値は線形区間で扱う（WGSL でも pow に負を渡さない）。

export type Vec3 = [number, number, number];
/** 行優先 9 要素 */
export type Mat3 = number[];
export type Xy = [number, number];

type M9 = [number, number, number, number, number, number, number, number, number];
const m9 = (m: Mat3): M9 => {
  if (m.length !== 9) throw new Error('Mat3 must have 9 elements');
  return m as M9;
};

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const A = m9(a), B = m9(b);
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(A[r * 3]! * B[c]! + A[r * 3 + 1]! * B[3 + c]! + A[r * 3 + 2]! * B[6 + c]!);
    }
  }
  return out;
}

export function apply3(m: Mat3, v: Vec3): Vec3 {
  const [a, b, c, d, e, f, g, h, i] = m9(m);
  return [a * v[0] + b * v[1] + c * v[2], d * v[0] + e * v[1] + f * v[2], g * v[0] + h * v[1] + i * v[2]];
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m9(m);
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0 || !Number.isFinite(det)) throw new Error('singular matrix');
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const D65_XY: Xy = [0.3127, 0.329];

/** xy（Y=1）→ XYZ */
export function xyToXyz([x, y]: Xy): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/** 原色 xy と白色点 xy から RGB → XYZ 行列を作る */
export function rgbToXyzMatrix(r: Xy, g: Xy, b: Xy, white: Xy): Mat3 {
  const [Xr, , Zr] = xyToXyz(r), [Xg, , Zg] = xyToXyz(g), [Xb, , Zb] = xyToXyz(b);
  const P: Mat3 = [Xr, Xg, Xb, 1, 1, 1, Zr, Zg, Zb];
  const [Sr, Sg, Sb] = apply3(inv3(P), xyToXyz(white));
  return [Xr * Sr, Xg * Sg, Xb * Sb, Sr, Sg, Sb, Zr * Sr, Zg * Sg, Zb * Sb];
}

export const REC2020_TO_XYZ: Mat3 = rgbToXyzMatrix([0.708, 0.292], [0.17, 0.797], [0.131, 0.046], D65_XY);
export const XYZ_TO_REC2020: Mat3 = inv3(REC2020_TO_XYZ);
export const SRGB_TO_XYZ: Mat3 = rgbToXyzMatrix([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65_XY);
export const XYZ_TO_SRGB: Mat3 = inv3(SRGB_TO_XYZ);
export const P3_TO_XYZ: Mat3 = rgbToXyzMatrix([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65_XY);
export const XYZ_TO_P3: Mat3 = inv3(P3_TO_XYZ);

/** エンコード値 → リニア */
export function srgbEotf(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** リニア → エンコード値 */
export function srgbOetf(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
