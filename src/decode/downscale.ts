// RGB Uint16 画像の面積平均縮小（長辺を maxEdge 以下に）。上限以下なら入力をそのまま返す。
export function downscaleArea(src: Uint16Array, w: number, h: number, maxEdge: number):
  { data: Uint16Array; width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { data: src, width: w, height: h };
  const s = maxEdge / long;
  const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
  const fx = w / dw, fy = h / dh;
  const out = new Uint16Array(dw * dh * 3);
  const acc = new Float64Array(dw * 3);
  for (let y = 0; y < dh; y++) {
    acc.fill(0);
    const y0 = y * fy, y1 = y0 + fy;
    let wsum = 0;
    for (let sy = Math.floor(y0); sy < Math.min(h, Math.ceil(y1)); sy++) {
      const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
      wsum += wy;
      const row = sy * w * 3;
      for (let x = 0; x < dw; x++) {
        const x0 = x * fx, x1 = x0 + fx;
        for (let sx = Math.floor(x0); sx < Math.min(w, Math.ceil(x1)); sx++) {
          const wgt = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = row + sx * 3;
          const a = x * 3;
          acc[a] = acc[a]! + wgt * src[i]!; acc[a + 1] = acc[a + 1]! + wgt * src[i + 1]!; acc[a + 2] = acc[a + 2]! + wgt * src[i + 2]!;
        }
      }
    }
    const norm = 1 / (wsum * fx);
    const o = y * dw * 3;
    for (let i = 0; i < dw * 3; i++) out[o + i] = Math.round(acc[i]! * norm);
  }
  return { data: out, width: dw, height: dh };
}
