// エンコード（仕様 6）: JPEG は MozJPEG（@jsquash/jpeg）、PNG は @jsquash/png。
import { encode as encodeJpeg } from '@jsquash/jpeg';
import { encode as encodePng } from '@jsquash/png';

export async function encode(rgba: Uint8ClampedArray, w: number, h: number, format: 'jpeg' | 'png', quality: number): Promise<Uint8Array> {
  const img = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h);
  const buf = format === 'jpeg'
    ? await encodeJpeg(img, { quality: Math.min(100, Math.max(1, Math.round(quality))) })
    : await encodePng(img);
  return new Uint8Array(buf);
}
