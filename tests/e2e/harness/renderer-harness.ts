// Renderer の E2E 入口（本番バンドル外）。
import { Renderer } from '../../../src/engine/renderer';
import { GpuOutOfMemoryError } from '../../../src/engine/errors';
import { createGpu } from '../../../src/engine/gpu';
import { defaultParams } from '../../../src/params/defaults';
import type { WorkingImage } from '../../../src/decode/types';

/** 保存画素 w×h を f(x,y) → [r,g,b]（リニア 0..1）で作る display 画像 */
function image(w: number, h: number, o: 1 | 3 | 6 | 8, f: (x: number, y: number) => [number, number, number]): WorkingImage {
  const px = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = f(x, y); const i = (y * w + x) * 3;
    px[i] = Math.round(c[0] * 65535); px[i + 1] = Math.round(c[1] * 65535); px[i + 2] = Math.round(c[2] * 65535);
  }
  return { width: w, height: h, fullWidth: w, fullHeight: h, orientation: o, kind: 'display', pixels: px, exif: {} };
}

async function make(opts: { previewCap?: number } = {}) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const gpu = await createGpu();
  const r = new Renderer(gpu, canvas, { previewCap: opts.previewCap ?? 2560, outSpace: 'srgb' });
  return { r, gpu, canvas };
}
const view = (w: number, h: number) => ({ mode: 'fit' as const, cx: 0.5, cy: 0.5, before: false, background: 'dark' as const, viewport: { w, h } });

const api = { make, image, view, defaultParams, isOom: (e: unknown) => e instanceof GpuOutOfMemoryError };
export type RendererHarness = typeof api;
(window as unknown as { __r: RendererHarness }).__r = api;
document.title = 'renderer-harness-ready';
