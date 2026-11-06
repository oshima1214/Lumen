// HEIC / HEIF のデコード。Safari は標準デコード（decodeDisplay）、それ以外は libheif-js（LGPL、遅延読み込み）。
// libheif は irot/imir を適用済みの画素を返すので orientation は 1 とする。
import { decodeDisplay } from './display';
import { readExif } from './exif';
import { rgba8ToLinear2020 } from './encoded';
import type { DecodedImage } from './types';

const isSafari = () => /Safari\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);

interface HeifImage { get_width(): number; get_height(): number;
  display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (r: { data: Uint8ClampedArray } | null) => void): void; free?(): void }
interface Libheif { HeifDecoder: new () => { decode(buf: Uint8Array): HeifImage[] } }
let libheif: Promise<Libheif> | null = null;

export async function decodeHeic(file: Blob): Promise<DecodedImage> {
  if (isSafari()) return decodeDisplay(file);
  const meta = await readExif(file);
  libheif ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => (m.default as () => Libheif)());
  const lib = await libheif;
  const images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  const img = images[0];
  if (!img) throw new Error('HEIC に画像がありません');
  const width = img.get_width(), height = img.get_height();
  const rgba = await new Promise<Uint8ClampedArray>((ok, ng) =>
    img.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (r) => (r ? ok(r.data) : ng(new Error('HEIC のデコードに失敗しました')))));
  for (const i of images) i.free?.();
  // iPhone の HEIC は Display P3。ICC が読めない場合も Apple 製なら P3 とみなす
  const p3 = meta.iccIsP3 || meta.exif.make === 'Apple';
  return { width, height, orientation: 1, kind: 'display', pixels: rgba8ToLinear2020(rgba, p3 ? 'p3' : 'srgb'), exif: meta.exif };
}
