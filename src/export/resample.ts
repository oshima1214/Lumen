// タイル単位の Lanczos-3 縮小。frame（原寸フレームの RGBA float、余白込み）から、出力の core 範囲の RGB float を作る。
// sx, sy = 出力 1px あたりのフレーム px（≥ 1）。等倍なら切り出すだけ。カーネルは縮小率に合わせて広げ、重みを正規化する。
import type { Rect } from '../engine/develop';

const lanczos3 = (x: number) => {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
};

/** 出力座標 o（core 内の各列/行）に対する、フレームのローカル座標での重み表 */
function weights(o0: number, n: number, s: number, f0: number, fn: number): { start: Int32Array; w: Float32Array[] } {
  const scale = Math.max(1, s), R = 3 * scale;
  const start = new Int32Array(n), w: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const c = (o0 + i + 0.5) * s - 0.5 - f0;          // フレームのローカル座標での中心
    const a = Math.max(0, Math.ceil(c - R)), b = Math.min(fn - 1, Math.floor(c + R));
    const ws = new Float32Array(Math.max(0, b - a + 1));
    let sum = 0;
    for (let k = a; k <= b; k++) { const v = lanczos3((k - c) / scale); ws[k - a] = v; sum += v; }
    if (sum !== 0) for (let k = 0; k < ws.length; k++) ws[k] = ws[k]! / sum;
    start[i] = a; w.push(ws);
  }
  return { start, w };
}

export function resampleTile(src: Float32Array, frame: Rect, core: Rect, sx: number, sy: number): Float32Array {
  const out = new Float32Array(core.w * core.h * 3);
  if (sx === 1 && sy === 1) {
    for (let y = 0; y < core.h; y++) for (let x = 0; x < core.w; x++) {
      const s = ((core.y + y - frame.y) * frame.w + core.x + x - frame.x) * 4, d = (y * core.w + x) * 3;
      out[d] = src[s]!; out[d + 1] = src[s + 1]!; out[d + 2] = src[s + 2]!;
    }
    return out;
  }
  const H = weights(core.x, core.w, sx, frame.x, frame.w), V = weights(core.y, core.h, sy, frame.y, frame.h);
  // 横方向: frame の全行 × core.w 列
  const tmp = new Float32Array(frame.h * core.w * 3);
  for (let y = 0; y < frame.h; y++) for (let x = 0; x < core.w; x++) {
    const a = H.start[x]!, ws = H.w[x]!;
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < ws.length; k++) { const s = (y * frame.w + a + k) * 4, v = ws[k]!; r += v * src[s]!; g += v * src[s + 1]!; b += v * src[s + 2]!; }
    const d = (y * core.w + x) * 3; tmp[d] = r; tmp[d + 1] = g; tmp[d + 2] = b;
  }
  // 縦方向
  for (let y = 0; y < core.h; y++) {
    const a = V.start[y]!, ws = V.w[y]!;
    for (let x = 0; x < core.w; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < ws.length; k++) { const s = ((a + k) * core.w + x) * 3, v = ws[k]!; r += v * tmp[s]!; g += v * tmp[s + 1]!; b += v * tmp[s + 2]!; }
      const d = (y * core.w + x) * 3; out[d] = r; out[d + 1] = g; out[d + 2] = b;
    }
  }
  return out;
}
