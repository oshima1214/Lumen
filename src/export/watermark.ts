// 透かし（仕様 6）: 文字または画像、9 方向の位置、大きさ（長辺比）、不透明度。OffscreenCanvas で合成する。
export type WatermarkPosition = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br';
export type Watermark = ({ kind: 'text'; text: string } | { kind: 'image'; image: Blob })
  & { position: WatermarkPosition; size: number; opacity: number };

function place(pos: WatermarkPosition, W: number, H: number, w: number, h: number, margin: number): [number, number] {
  const col = pos.endsWith('l') && pos !== 'l' ? 0 : pos === 'l' ? 0 : pos.endsWith('r') ? 2 : 1;
  const row = pos.startsWith('t') ? 0 : pos.startsWith('b') ? 2 : 1;
  const x = col === 0 ? margin : col === 2 ? W - w - margin : (W - w) / 2;
  const y = row === 0 ? margin : row === 2 ? H - h - margin : (H - h) / 2;
  return [x, y];
}

export async function applyWatermark(rgba: Uint8ClampedArray, w: number, h: number, wm: Watermark): Promise<void> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D コンテキストを作れません');
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const long = Math.max(w, h), size = Math.min(0.5, Math.max(0.02, wm.size)) * long, margin = Math.round(long * 0.02);
  ctx.globalAlpha = Math.min(1, Math.max(0, wm.opacity));
  if (wm.kind === 'text') {
    ctx.font = `600 ${Math.round(size)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(wm.text).width;
    const [x, y] = place(wm.position, w, h, tw, size, margin);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = size * 0.1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(wm.text, x, y);
  } else {
    const bmp = await createImageBitmap(wm.image);
    const s = size / Math.max(bmp.width, bmp.height);
    const iw = bmp.width * s, ih = bmp.height * s;
    const [x, y] = place(wm.position, w, h, iw, ih, margin);
    ctx.drawImage(bmp, x, y, iw, ih);
    bmp.close();
  }
  rgba.set(ctx.getImageData(0, 0, w, h).data);
}
