// iOS が HEIC / ProRAW を JPEG などに変換して渡したかの判定（仕様 2.4 / 7）。
import { extOf } from './names';

const DISPLAY_MIME: Record<string, string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  heic: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  heif: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
};
const RAW_EXTS = new Set(['cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw']);
/** 変換後の形式として現れうる表示用の MIME */
const CONVERTED_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/avif']);

/**
 * 拡張子が示す形式と File.type が食い違えば true（例: IMG_0001.HEIC なのに image/jpeg）。
 * type が空・汎用（application/octet-stream）・拡張子が不明なときは判断できないので false。
 */
export function looksTranscoded(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type === '' || type === 'application/octet-stream') return false;
  const ext = extOf(file.name);
  const display = DISPLAY_MIME[ext];
  if (display) return type.startsWith('image/') && !display.includes(type);
  if (RAW_EXTS.has(ext)) return CONVERTED_MIME.has(type);
  return false;
}
