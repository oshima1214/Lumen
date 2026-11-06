// デコード系 E2E の入口（本番バンドル外）。
import { decodeDisplay } from '../../../src/decode/display';
import { decodeHeic } from '../../../src/decode/heic';
import { readExif } from '../../../src/decode/exif';

async function file(p: string): Promise<File> {
  const r = await fetch('/__e2e/files/' + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return new File([await r.blob()], p.split('/').pop()!);
}

const api = { file, decodeDisplay, decodeHeic, readExif };
export type DecodeHarness = typeof api;
(window as unknown as { __decode: DecodeHarness }).__decode = api;
document.title = 'decode-harness-ready';
