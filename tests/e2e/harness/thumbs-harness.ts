// ThumbCache を実 IndexedDB と実 Decoder（Worker）で動かす E2E 入口（本番バンドル外）。
import { Decoder } from '../../../src/decode/client';
import { ThumbCache, idbThumbStore, THUMB_EDGE } from '../../../src/cache/thumbs';
import type { ImageRef } from '../../../src/storage/types';

const real = new Decoder();
let active = 0;
const stats = { calls: 0, maxActive: 0 };
const decoder = {
  async preview(file: Blob, name: string, maxEdge: number): Promise<Blob> {
    stats.calls++; active++; stats.maxActive = Math.max(stats.maxActive, active);
    try { return await real.preview(file, name, maxEdge); } finally { active--; }
  },
};
async function readOriginal(id: string): Promise<File> {
  const p = id.replace(/#\d+$/, '');
  const r = await fetch('/__e2e/files/' + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return new File([await r.blob()], p.split('/').pop()!);
}
function make(db: string): ThumbCache { return new ThumbCache(decoder, readOriginal, 'folder', idbThumbStore(db)); }
function ref(id: string, mtime = 1): ImageRef { return { id, name: id.split('/').pop()!.replace(/#\d+$/, ''), size: 1, mtime, group: '' }; }
async function size(b: Blob): Promise<{ w: number; h: number; type: string }> {
  const bmp = await createImageBitmap(b);
  return { w: bmp.width, h: bmp.height, type: b.type };
}
const api = { make, ref, stats, size, THUMB_EDGE };
export type ThumbsHarness = typeof api;
(window as unknown as { __th: ThumbsHarness }).__th = api;
document.title = 'thumbs-harness-ready';
