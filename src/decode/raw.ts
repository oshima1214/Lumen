// RAW / DNG（ProRAW を含む）のデコード。libraw-wasm（ISC、LibRaw は LGPL/CDDL）を使う。
// 選定理由と設定の根拠: docs/decisions/libraw-wasm.md
// 出力はカメラ RGB リニア（WB 倍率 1、自動明るさなし、ガンマ 1、16bit）で、白レベルが 65535 になる。
import LibRaw from 'libraw-wasm';
import { inv3, mul3, SRGB_TO_XYZ, type Mat3, type Vec3 } from '../color/spaces';
import type { DecodedImage, ExifSummary, Orientation } from './types';

const SETTINGS = {
  outputColor: 0,          // raw color（カメラ RGB）
  outputBps: 16,
  noAutoBright: true,
  gamm: [1, 1] as [number, number],
  useCameraWb: false,
  useAutoWb: false,
  userMul: [1, 1, 1, 1] as [number, number, number, number],
  userFlip: 0,             // 回転しない（orientation として返す）
  highlight: 0,            // クリップ（ハイライト処理はパイプライン側）
  userQual: 3,             // AHD
};

/** LibRaw の flip（0/3/5/6）を EXIF orientation に変換する */
function flipToOrientation(flip: number): Orientation {
  return flip === 3 ? 3 : flip === 5 ? 8 : flip === 6 ? 6 : 1;
}

function dms(v: [number, number, number] | undefined, ref: string | null | undefined): number | undefined {
  if (!v || v.every((x) => x === 0)) return undefined;
  const d = v[0] + v[1] / 60 + v[2] / 3600;
  return ref === 'S' || ref === 'W' ? -d : d;
}

type Meta = NonNullable<Awaited<ReturnType<LibRaw['metadata']>>>;

function exifOf(m: Meta): ExifSummary {
  const e: ExifSummary = {};
  if (m.camera_make) e.make = m.camera_make.trim();
  if (m.camera_model) e.model = m.camera_model.trim();
  if (m.iso_speed > 0) e.iso = m.iso_speed;
  if (m.shutter > 0) e.exposureTime = m.shutter;
  if (m.aperture > 0) e.fNumber = m.aperture;
  if (m.focal_len > 0) e.focalLength = m.focal_len;
  const ts = m.timestamp instanceof Date ? m.timestamp : null;
  if (ts && ts.getTime() > 0) e.date = ts.toISOString();
  const lens = (m as { lens?: { Lens?: string; lens?: string } }).lens;
  const lensName = (lens?.Lens ?? lens?.lens ?? '').trim();
  if (lensName) e.lens = lensName;
  const g = m.gps_data;
  if (g?.gpsparsed) {
    const lat = dms(g.latitude, g.latref), lon = dms(g.longitude, g.longref);
    if (lat !== undefined && lon !== undefined) e.gps = { lat, lon };
  }
  return e;
}

const top3 = (m: number[][] | undefined): Mat3 | undefined => {
  if (!m || m.length < 3) return undefined;
  const r = [...m[0]!.slice(0, 3), ...m[1]!.slice(0, 3), ...m[2]!.slice(0, 3)];
  return r.length === 9 && r.some((v) => v !== 0) && r.every(Number.isFinite) ? r : undefined;
};
// DNG の CalibrationIlluminant: 21 = D65, 20 = D55, 23 = D50, 17 = A。D65 に近いものを優先する
const ILLUMINANT_PREF = [21, 20, 23, 22, 17];

/** カメラ RGB → XYZ(D65)。
 *  1) cam_xyz（XYZ → カメラ、LibRaw の内蔵表）の逆行列
 *  2) DNG の ColorMatrix（XYZ → カメラ、D65 に近い光源のもの）の逆行列
 *  3) rgb_cam（カメラ → sRGB）に sRGB → XYZ を掛けたもの */
function camToXyzOf(cd: Meta['color_data']): Mat3 | undefined {
  const fromCam = top3(cd?.cam_xyz);
  if (fromCam) return inv3(fromCam);
  const dng = [...(cd?.dng_color ?? [])].filter((c) => top3(c.colormatrix))
    .sort((a, b) => rank(a.illuminant) - rank(b.illuminant));
  const cm = dng[0] ? top3(dng[0].colormatrix) : undefined;
  if (cm) return inv3(cm);
  const rgbCam = top3(cd?.rgb_cam);
  return rgbCam ? mul3(SRGB_TO_XYZ, rgbCam) : undefined;
}
function rank(illuminant: number): number {
  const i = ILLUMINANT_PREF.indexOf(illuminant);
  return i < 0 ? ILLUMINANT_PREF.length : i;
}

/** 撮影時 WB 係数（cam_mul、無ければ pre_mul）からカメラ RGB の中性点（G=1）を求める */
function neutralOf(cd: Meta['color_data']): Vec3 | undefined {
  const an = cd?.dng_levels?.asshotneutral;
  if (an && an[0]! > 0 && an[1]! > 0 && an[2]! > 0) return [an[0]! / an[1]!, 1, an[2]! / an[1]!];
  for (const mul of [cd?.cam_mul, cd?.pre_mul]) {
    if (!mul || !(mul[0]! > 0 && mul[1]! > 0 && mul[2]! > 0)) continue;
    return [mul[1]! / mul[0]!, 1, mul[1]! / mul[2]!];
  }
  return undefined;
}

async function withLibRaw<T>(file: Blob, fn: (lr: LibRaw) => Promise<T>): Promise<T> {
  const lr = new LibRaw();
  try {
    await lr.open(new Uint8Array(await file.arrayBuffer()), SETTINGS);
    return await fn(lr);
  } finally {
    lr.dispose();
  }
}

export async function decodeRaw(file: Blob): Promise<DecodedImage> {
  return withLibRaw(file, async (lr) => {
    const meta = await lr.metadata(true);   // color_data（cam_xyz 等）は fullOutput でのみ返る
    if (!meta) throw new Error('RAW のメタデータを読めません');
    const img = await lr.imageData();
    if (!img || !(img.data instanceof Uint16Array) || img.colors < 3) throw new Error('RAW の画素を読めません');
    let pixels = img.data;
    if (img.colors !== 3) {          // 念のため 4ch 出力は RGB に詰め直す
      const n = img.width * img.height;
      const out = new Uint16Array(n * 3);
      for (let i = 0; i < n; i++) { out[i * 3] = pixels[i * img.colors]!; out[i * 3 + 1] = pixels[i * img.colors + 1]!; out[i * 3 + 2] = pixels[i * img.colors + 2]!; }
      pixels = out;
    }
    const cd = meta.color_data;
    const camToXyz = camToXyzOf(cd);
    if (!camToXyz) throw new Error('カメラのカラーマトリクスがありません（非対応機種の可能性）');
    const asShotNeutral = neutralOf(cd) ?? [1, 1, 1];
    return {
      width: img.width, height: img.height, orientation: flipToOrientation(meta.flip), kind: 'raw',
      pixels, camToXyz, asShotNeutral, exif: exifOf(meta),
    };
  });
}

/** 埋め込み JPEG プレビュー（無い・JPEG 以外なら null） */
export async function extractRawPreview(file: Blob): Promise<Blob | null> {
  try {
    return await withLibRaw(file, async (lr) => {
      const t = await lr.thumbnailData();
      if (!t || t.format !== 'jpeg' || !t.data?.length) return null;
      return new Blob([t.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
    });
  } catch {
    return null;
  }
}
