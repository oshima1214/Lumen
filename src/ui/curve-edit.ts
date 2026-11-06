// トーンカーブの点の編集（純粋関数、計画 Task 25）。点は x 昇順、端点（先頭と末尾）は x を固定する。
import type { CurvePoint } from '../params/types';

export const MAX_POINTS = 16;
const GAP = 0.01;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1e6) / 1e6;

export function addPoint(pts: CurvePoint[], x: number, y: number): CurvePoint[] {
  if (pts.length >= MAX_POINTS) return pts;
  const nx = clamp01(x);
  if (pts.some((p) => Math.abs(p[0] - nx) < GAP)) return pts;
  return [...pts, [nx, clamp01(y)] as CurvePoint].sort((a, b) => a[0] - b[0]);
}

export function movePoint(pts: CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
  const p = pts[i];
  if (!p) return pts;
  let nx = p[0];
  if (i > 0 && i < pts.length - 1) nx = round(Math.min(pts[i + 1]![0] - GAP, Math.max(pts[i - 1]![0] + GAP, x)));
  const out = pts.map((q) => [q[0], q[1]] as CurvePoint);
  out[i] = [nx, clamp01(y)];
  return out;
}

export function removePoint(pts: CurvePoint[], i: number): CurvePoint[] {
  if (i <= 0 || i >= pts.length - 1) return pts;
  return pts.filter((_, k) => k !== i);
}
