// 出力シャープ（アンシャープマスク、仕様 6）。半径 σ = 長辺/2000 px（最小 0.5）、量: 弱 0.3 / 標準 0.6 / 強 1.0、閾値 2/255。
export type SharpenLevel = 'none' | 'low' | 'standard' | 'high';
const AMOUNT: Record<SharpenLevel, number> = { none: 0, low: 0.3, standard: 0.6, high: 1.0 };
const THRESHOLD = 2 / 255;

export const sharpenSigma = (longEdge: number) => Math.max(0.5, longEdge / 2000);
/** シャープに要る周囲の余白（出力 px） */
export const sharpenMargin = (level: SharpenLevel, longEdge: number) => (level === 'none' ? 0 : Math.ceil(3 * sharpenSigma(longEdge)) + 1);

function kernel(sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma), k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
  return k.map((v) => v / s);
}

/** rgb（w×h、RGB float）にアンシャープマスクをかける（その場で書き換え）。端は端の画素で延長 */
export function unsharp(rgb: Float32Array, w: number, h: number, level: SharpenLevel, longEdge: number): void {
  const amount = AMOUNT[level];
  if (amount === 0) return;
  const k = kernel(sharpenSigma(longEdge)), r = (k.length - 1) / 2;
  const tmp = new Float32Array(rgb.length), blur = new Float32Array(rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r]! * rgb[(y * w + Math.min(w - 1, Math.max(0, x + i))) * 3 + c]!;
    tmp[(y * w + x) * 3 + c] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r]! * tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * 3 + c]!;
    blur[(y * w + x) * 3 + c] = s;
  }
  for (let i = 0; i < rgb.length; i++) {
    const d = rgb[i]! - blur[i]!;
    if (Math.abs(d) > THRESHOLD) rgb[i] = rgb[i]! + amount * d;
  }
}
