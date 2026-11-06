// 先頭バイトと拡張子から形式を判定する。RAW は TIFF 系ヘッダ＋RAW 拡張子のときだけ raw。
import type { Format } from './types';

export const RAW_EXTS = ['cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'];
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const str = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export function sniffFormat(head: Uint8Array, name: string): Format {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && str(head, 1, 3) === 'PNG') return 'png';
  if (str(head, 4, 4) === 'ftyp') {
    const brand = str(head, 8, 4);
    if (HEIC_BRANDS.includes(brand)) return 'heic';
    if (brand === 'crx ' && ext(name) === 'cr3') return 'raw';
  }
  const tiff = (head[0] === 0x49 && head[1] === 0x49 && (head[2] === 0x2a || head[2] === 0x52 || head[2] === 0x55))
    || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 0x2a);
  if (tiff && RAW_EXTS.includes(ext(name))) return 'raw';
  return 'unknown';
}
