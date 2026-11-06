// JPEG / PNG（と Safari の HEIC）をブラウザ標準でデコードし、リニア Rec.2020 にする（仕様 3.1）。
// 返す画素と orientation の組は常に整合する（向き未適用なら EXIF の値、適用済みなら 1）。埋め込み ICC は Display P3 か否かだけ判定する。
import { readExif } from './exif';
import { rgba8ToLinear2020 } from './encoded';
import type { DecodedImage } from './types';

// ブラウザによっては imageOrientation: 'none' を無視して EXIF の向きを適用する（Chromium で確認）。
// 2x1・orientation 6 の JPEG を一度だけデコードし、1x2 になれば「向き適用済み」と判定する。
const PROBE = '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDFoooryz7w/9k=';
let appliesOrientation: Promise<boolean> | null = null;
function browserAppliesOrientation(): Promise<boolean> {
  appliesOrientation ??= (async () => {
    const bytes = Uint8Array.from(atob(PROBE), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { imageOrientation: 'none' });
    const rotated = bmp.width === 1 && bmp.height === 2;
    bmp.close();
    return rotated;
  })();
  return appliesOrientation;
}

export async function decodeDisplay(file: Blob): Promise<DecodedImage> {
  const meta = await readExif(file);
  const bmp = await createImageBitmap(file, { imageOrientation: 'none', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const { width, height } = bmp;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) throw new Error('2D コンテキストを作れません');
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    // 向きが適用済みなら画素はすでに正立しているので orientation は 1
    const orientation = (await browserAppliesOrientation()) ? 1 : meta.orientation;
    return {
      width, height, orientation, kind: 'display',
      pixels: rgba8ToLinear2020(data, meta.iccIsP3 ? 'p3' : 'srgb'), exif: meta.exif,
    };
  } finally {
    bmp.close();
  }
}
