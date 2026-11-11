// ブラウザのデコード結果に EXIF の向きが適用済みかを、ファイルごとに判定する（最終レビュー I5c）。
// - HEIC: irot は必ず適用されるので 1
// - 90°（6/8）: EXIF に記録された（向き補正前の）寸法とビットマップの寸法を比べる。縦横が入れ替わっていれば適用済み
// - 180°（3）や寸法が無いとき: 起動時のプローブ（このブラウザは JPEG の向きを適用するか）に従う
import type { Orientation } from './types';

export function resolveOrientation(a: {
  exif: Orientation; exifDims: { w: number; h: number } | null; bitmap: { w: number; h: number };
  probeApplies: boolean; heic: boolean;
}): Orientation {
  if (a.heic || a.exif === 1) return 1;
  if ((a.exif === 6 || a.exif === 8) && a.exifDims && a.exifDims.w !== a.exifDims.h) {
    const swapped = a.bitmap.w === a.exifDims.h && a.bitmap.h === a.exifDims.w;
    const same = a.bitmap.w === a.exifDims.w && a.bitmap.h === a.exifDims.h;
    if (swapped) return 1;
    if (same) return a.exif;
  }
  return a.probeApplies ? 1 : a.exif;
}
