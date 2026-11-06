// デコード結果の型（仕様 2.3）。pixels は RGB 3ch、0..1 を 0..65535 に正規化した値。
import type { Mat3, Vec3 } from '../color/spaces';

export type Orientation = 1 | 3 | 6 | 8;

export interface ExifSummary {
  date?: string; make?: string; model?: string; lens?: string; iso?: number;
  exposureTime?: number; fNumber?: number; focalLength?: number;
  gps?: { lat: number; lon: number };
}

export interface DecodedImage {
  width: number; height: number;            // 向き補正前の寸法
  orientation: Orientation;
  kind: 'raw' | 'display';                  // raw = カメラ RGB リニア、display = リニア Rec.2020
  pixels: Uint16Array;
  camToXyz?: Mat3;
  asShotNeutral?: Vec3;
  exif: ExifSummary;
}

/** 作業画像: pixels は長辺上限まで縮小済み。fullWidth/Height は元データの寸法 */
export interface WorkingImage extends DecodedImage { fullWidth: number; fullHeight: number }

export type Format = 'raw' | 'jpeg' | 'png' | 'heic' | 'unknown';
