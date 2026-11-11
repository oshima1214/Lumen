// サムネイル用の縮小 JPEG を作る。RAW は埋め込み JPEG を優先し、無ければ既定パラメータで CPU 現像する。
import { buildUniforms } from '../color/uniforms';
import { developPixel } from '../color/pipeline';
import { defaultParams } from '../params/defaults';
import { downscaleArea } from './downscale';
import { extractRawPreview } from './raw';
import type { DecodedImage } from './types';

async function resizeEncoded(blob: Blob, maxEdge: number): Promise<Blob> {
  const probe = await createImageBitmap(blob);
  const s = Math.min(1, maxEdge / Math.max(probe.width, probe.height));
  const w = Math.max(1, Math.round(probe.width * s)), h = Math.max(1, Math.round(probe.height * s));
  probe.close();
  const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/** 既定パラメータで現像した sRGB の縮小 JPEG（向きは適用しない＝表示側で回す） */
export async function renderPreview(img: DecodedImage, maxEdge: number): Promise<Blob> {
  const small = downscaleArea(img.pixels, img.width, img.height, maxEdge);
  const { u, luts } = buildUniforms(defaultParams(), img, 'srgb');
  const n = small.width * small.height;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = developPixel([small.data[i * 3]! / 65535, small.data[i * 3 + 1]! / 65535, small.data[i * 3 + 2]! / 65535], 0.18, u, luts);
    rgba[i * 4] = o[0] * 255 + 0.5; rgba[i * 4 + 1] = o[1] * 255 + 0.5; rgba[i * 4 + 2] = o[2] * 255 + 0.5; rgba[i * 4 + 3] = 255;
  }
  const c = new OffscreenCanvas(small.width, small.height);
  c.getContext('2d')!.putImageData(new ImageData(rgba, small.width, small.height), 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export async function makePreview(file: Blob, isRaw: boolean, maxEdge: number, decode: () => Promise<DecodedImage>): Promise<Blob> {
  if (isRaw) {
    const embedded = await extractRawPreview(file);
    if (embedded) return resizeEncoded(embedded, maxEdge);
    return renderPreview(await decode(), maxEdge);
  }
  try {
    return await resizeEncoded(file, maxEdge);   // JPEG/PNG/（Safari の）HEIC はブラウザで縮小
  } catch {
    return renderPreview(await decode(), maxEdge);   // ブラウザが読めない HEIC など
  }
}
