// 単調 3 次スプライン（Fritsch–Carlson）と 1D LUT。
// - monotoneSpline: x で並べ替え、同じ x は後の点を採用。範囲外は端点の y（平坦に外挿）。
//   接線: 端は片側の傾き、内部は隣接する傾きの平均（符号が違えば 0）。α²+β² > 9 なら τ=3/√(α²+β²) で縮める。
// - LUT は x_i = i/(n-1) の n 点。sampleLut は [0,1] に丸めてから隣接 2 点の線形補間（WGSL と同じ式）:
//     t = clamp(x,0,1)·(n-1); i0 = floor(t); i1 = min(i0+1, n-1); lut[i0] + (lut[i1]-lut[i0])·(t-i0)
import type { CurvePoint } from '../params/types';

export const LUT_SIZE = 1024;

export function monotoneSpline(points: CurvePoint[]): (x: number) => number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of sorted) {
    if (xs.length > 0 && x === xs[xs.length - 1]) ys[ys.length - 1] = y;
    else { xs.push(x); ys.push(y); }
  }
  const n = xs.length;
  if (n === 0) return (x) => x;
  if (n === 1) { const y0 = ys[0]!; return () => y0; }

  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1]! - ys[k]!) / (xs[k + 1]! - xs[k]!));
  const m: number[] = new Array<number>(n).fill(0);
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let k = 1; k < n - 1; k++) {
    const a = d[k - 1]!, b = d[k]!;
    m[k] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let k = 0; k < n - 1; k++) {
    const dk = d[k]!;
    if (dk === 0) { m[k] = 0; m[k + 1] = 0; continue; }
    const a = m[k]! / dk, b = m[k + 1]! / dk;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * dk;
      m[k + 1] = t * b * dk;
    }
  }

  const x0 = xs[0]!, xn = xs[n - 1]!, y0 = ys[0]!, yn = ys[n - 1]!;
  return (x: number) => {
    if (x <= x0) return y0;
    if (x >= xn) return yn;
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]!) k++;
    const h = xs[k + 1]! - xs[k]!;
    const t = (x - xs[k]!) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k]! + (t3 - 2 * t2 + t) * h * m[k]!
      + (-2 * t3 + 3 * t2) * ys[k + 1]! + (t3 - t2) * h * m[k + 1]!;
  };
}

export function bakeLut(f: (x: number) => number, n: number = LUT_SIZE): Float32Array {
  const lut = new Float32Array(n);
  for (let i = 0; i < n; i++) lut[i] = f(i / (n - 1));
  return lut;
}

export function sampleLut(lut: Float32Array, x: number): number {
  const n = lut.length;
  const t = Math.min(1, Math.max(0, x)) * (n - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(i0 + 1, n - 1);
  const a = lut[i0]!, b = lut[i1]!;
  return a + (b - a) * (t - i0);
}
