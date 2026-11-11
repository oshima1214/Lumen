// デコード系 E2E の入口（本番バンドル外）。
import { decodeDisplay } from '../../../src/decode/display';
import { decodeHeic } from '../../../src/decode/heic';
import { readExif } from '../../../src/decode/exif';
import { decodeRaw, extractRawPreview } from '../../../src/decode/raw';
import { asShotCctTint } from '../../../src/color/wb';

async function file(p: string): Promise<File> {
  const r = await fetch('/__e2e/files/' + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return new File([await r.blob()], p.split('/').pop()!);
}

/** RAW をデコードしてテストに必要な要約だけ返す（大きな配列を Playwright に渡さない） */
async function rawSummary(p: string) {
  const img = await decodeRaw(await file(p));
  let max = 0, sum = 0, n = 0;
  for (let i = 0; i < img.pixels.length; i++) if (img.pixels[i]! > max) max = img.pixels[i]!;
  const cx = img.width >> 1, cy = img.height >> 1;
  for (let y = cy - 32; y < cy + 32; y++) for (let x = cx - 32; x < cx + 32; x++) { sum += img.pixels[(y * img.width + x) * 3 + 1]!; n++; }
  const prev = await extractRawPreview(await file(p));
  const head = prev ? Array.from(new Uint8Array(await prev.slice(0, 3).arrayBuffer())) : null;
  return { w: img.width, h: img.height, kind: img.kind, o: img.orientation, model: img.exif.model ?? '', neutral: img.asShotNeutral ?? null,
    camToXyz: img.camToXyz ?? null, max,
    asShot: img.camToXyz && img.asShotNeutral ? asShotCctTint(img.camToXyz, img.asShotNeutral) : null, centerMean: sum / n, previewHead: head };
}
async function rawError(bytes: number[], name: string): Promise<string | null> {
  try { await decodeRaw(new File([new Uint8Array(bytes)], name)); return null; } catch (e) { return String(e); }
}

const api = { file, decodeDisplay, decodeHeic, readExif, rawSummary, rawError };
export type DecodeHarness = typeof api;
(window as unknown as { __decode: DecodeHarness }).__decode = api;
document.title = 'decode-harness-ready';
