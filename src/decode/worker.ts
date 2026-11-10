// デコード Worker。同時に 1 枚分の元データ（フル解像度）だけを保持する（仕様 3.1）。
/// <reference lib="webworker" />
import { decodeAny, DecodeError, formatOf } from './decode-any';
import { downscaleArea } from './downscale';
import { makePreview } from './preview';
import type { WorkingImage } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
export type Request =
  | { id: number; type: 'open'; file: Blob; name: string; workCap: number; retain: boolean }
  | { id: number; type: 'readTile'; handle: string; rect: Rect }
  | { id: number; type: 'close'; handle: string }
  | { id: number; type: 'preview'; file: Blob; name: string; maxEdge: number };
export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; decodeFormat?: string };

let current: { handle: string; width: number; height: number; pixels: Uint16Array } | null = null;
let seq = 0;

function readTile(handle: string, r: Rect): Uint16Array {
  if (!current || current.handle !== handle) throw new Error('画像はもう開かれていません');
  const { width, height, pixels } = current;
  const out = new Uint16Array(r.w * r.h * 3);
  for (let y = 0; y < r.h; y++) {
    const sy = Math.min(height - 1, Math.max(0, r.y + y));
    for (let x = 0; x < r.w; x++) {
      const sx = Math.min(width - 1, Math.max(0, r.x + x));
      const s = (sy * width + sx) * 3, d = (y * r.w + x) * 3;
      out[d] = pixels[s]!; out[d + 1] = pixels[s + 1]!; out[d + 2] = pixels[s + 2]!;
    }
  }
  return out;
}

async function handle(m: Request): Promise<{ value: unknown; transfer: Transferable[] }> {
  switch (m.type) {
    case 'open': {
      current = null;                                    // 前の元データを先に手放す
      const { image } = await decodeAny(m.file, m.name);
      const handle = `h${++seq}`;
      const small = downscaleArea(image.pixels, image.width, image.height, m.workCap);
      // retain: true（書き出し）なら元データを Worker に残して readTile に使う。編集用（false）は残さない（最終レビュー I4a）
      if (m.retain) current = { handle, width: image.width, height: image.height, pixels: image.pixels };
      const data = small.data === image.pixels && m.retain ? image.pixels.slice() : small.data;
      const working: WorkingImage = { ...image, pixels: data, width: small.width, height: small.height,
        fullWidth: image.width, fullHeight: image.height };
      return { value: { handle, working }, transfer: [data.buffer] };
    }
    case 'readTile': { const t = readTile(m.handle, m.rect); return { value: t, transfer: [t.buffer] }; }
    case 'close': if (current?.handle === m.handle) current = null; return { value: null, transfer: [] };
    case 'preview': {
      const isRaw = (await formatOf(m.file, m.name)) === 'raw';
      const blob = await makePreview(m.file, isRaw, m.maxEdge, async () => (await decodeAny(m.file, m.name)).image);
      return { value: blob, transfer: [] };
    }
  }
}

// 要求は 1 件ずつ順に処理する（連続した open でフル解像度のデコードが並行しないように。最終レビュー I4b）
let queue: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent<Request>) => {
  const m = ev.data;
  queue = queue.then(() => process(m));
};

async function process(m: Request): Promise<void> {
  try {
    const { value, transfer } = await handle(m);
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, value } satisfies Response, transfer);
  } catch (e) {
    const res: Response = { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e),
      ...(e instanceof DecodeError ? { decodeFormat: e.format } : {}) };
    (self as unknown as Worker).postMessage(res);
  }
}
