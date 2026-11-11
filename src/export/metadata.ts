// 書き出しファイルへのメタデータ付加（仕様 6）: EXIF（撮影日時・機種・レンズ・露出・GPS は任意、Orientation=1）と ICC。
// JPEG: piexifjs で APP1 を入れ、APP2 ICC_PROFILE を足す。PNG: IHDR の直後に iCCP（zlib 圧縮）と eXIf を足す。
import piexif from 'piexifjs';
import { SRGB_ICC_B64, P3_ICC_B64 } from './icc/profiles';
import type { ExifSummary } from '../decode/types';

const ICC: Record<'srgb' | 'p3', { name: string; b64: string }> = {
  srgb: { name: 'sRGB', b64: SRGB_ICC_B64 }, p3: { name: 'Display P3', b64: P3_ICC_B64 },
};
const iccBytes = (space: 'srgb' | 'p3'): Uint8Array => Uint8Array.from(atob(ICC[space].b64), (c) => c.charCodeAt(0));

const toBin = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };
const fromBin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const rational = (v: number, den = 10000): [number, number] => [Math.round(v * den), den];
const exposure = (t: number): [number, number] => (t >= 1 ? rational(t, 10) : [1, Math.round(1 / t)]);
const pad = (n: number) => String(n).padStart(2, '0');
// exifr は EXIF の日時をローカル時刻として Date にする。逆変換もローカルの値で書く
const exifDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function dms(v: number): [[number, number], [number, number], [number, number]] {
  const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = (a - d - m / 60) * 3600;
  return [[d, 1], [m, 1], rational(s, 100)];
}

/** "Exif\0\0" + TIFF の EXIF バイト列 */
function exifBlock(e: ExifSummary, stripGps: boolean): string {
  const I = piexif.ImageIFD, X = piexif.ExifIFD, G = piexif.GPSIFD;
  const zeroth: Record<number, unknown> = { [I.Orientation]: 1, [I.Software]: 'Lumen' };
  if (e.make) zeroth[I.Make] = e.make;
  if (e.model) zeroth[I.Model] = e.model;
  const ex: Record<number, unknown> = {};
  if (e.date) { ex[X.DateTimeOriginal] = exifDate(e.date); zeroth[I.DateTime] = exifDate(e.date); }
  if (e.iso) ex[X.ISOSpeedRatings] = Math.round(e.iso);
  if (e.exposureTime) ex[X.ExposureTime] = exposure(e.exposureTime);
  if (e.fNumber) ex[X.FNumber] = rational(e.fNumber, 100);
  if (e.focalLength) ex[X.FocalLength] = rational(e.focalLength, 100);
  if (e.lens) ex[X.LensModel] = e.lens;
  const gps: Record<number, unknown> = {};
  if (e.gps && !stripGps) {
    gps[G.GPSLatitudeRef] = e.gps.lat >= 0 ? 'N' : 'S'; gps[G.GPSLatitude] = dms(e.gps.lat);
    gps[G.GPSLongitudeRef] = e.gps.lon >= 0 ? 'E' : 'W'; gps[G.GPSLongitude] = dms(e.gps.lon);
  }
  return piexif.dump({ '0th': zeroth, Exif: ex, GPS: gps });
}

function jpegWithIcc(jpeg: Uint8Array, icc: Uint8Array): Uint8Array {
  // SOI の直後に続く APPn の後ろ（最初の非 APP マーカーの前）に APP2 ICC_PROFILE を入れる
  let pos = 2;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff && jpeg[pos + 1]! >= 0xe0 && jpeg[pos + 1]! <= 0xef) pos += 2 + ((jpeg[pos + 2]! << 8) | jpeg[pos + 3]!);
  const head = new TextEncoder().encode('ICC_PROFILE\0');
  const len = 2 + head.length + 2 + icc.length;
  const seg = new Uint8Array(2 + len);
  seg.set([0xff, 0xe2, len >> 8, len & 0xff]); seg.set(head, 4); seg.set([1, 1], 4 + head.length); seg.set(icc, 6 + head.length);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, pos)); out.set(seg, pos); out.set(jpeg.subarray(pos), pos + seg.length);
  return out;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function zlib(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function pngWith(png: Uint8Array, icc: Uint8Array, iccName: string, exifTiff: Uint8Array): Promise<Uint8Array> {
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const name = new TextEncoder().encode(iccName.slice(0, 79));
  const z = await zlib(icc);
  const iccp = new Uint8Array(name.length + 2 + z.length); iccp.set(name); iccp.set([0, 0], name.length); iccp.set(z, name.length + 2);
  const add = [chunk('iCCP', iccp), chunk('eXIf', exifTiff)];
  const total = add.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(png.length + total);
  out.set(png.subarray(0, ihdrEnd)); let p = ihdrEnd;
  for (const c of add) { out.set(c, p); p += c.length; }
  out.set(png.subarray(ihdrEnd), p);
  return out;
}

export async function withMetadata(bytes: Uint8Array, format: 'jpeg' | 'png', exif: ExifSummary, space: 'srgb' | 'p3', stripGps: boolean): Promise<Uint8Array> {
  const block = exifBlock(exif, stripGps);
  const icc = iccBytes(space);
  if (format === 'jpeg') return jpegWithIcc(fromBin(piexif.insert(block, toBin(bytes))), icc);
  return pngWith(bytes, icc, ICC[space].name, fromBin(block.slice(6)));   // eXIf は "Exif\0\0" を除いた TIFF
}
