// 書き出し Worker: タイルを受け取って縮小・シャープ・8bit 化し、最後に透かし・エンコード・メタデータを付ける。
// メインスレッドは GPU 現像だけを行う（仕様 6）。出力バッファは出力サイズの RGBA8 だけ（仕様 3.4）。
/// <reference lib="webworker" />
import { resampleTile } from './resample';
import { unsharp, type SharpenLevel } from './sharpen';
import { applyWatermark, type Watermark } from './watermark';
import { encode } from './encode';
import { withMetadata } from './metadata';
import type { Rect } from '../engine/develop';
import type { ExifSummary } from '../decode/types';

export type ExportWorkerRequest =
  | { id: number; type: 'begin'; outW: number; outH: number }
  | { id: number; type: 'tile'; rgba: Float32Array; frame: Rect; core: Rect; sx: number; sy: number; sharpen: SharpenLevel; margin: number }
  | { id: number; type: 'finish'; format: 'jpeg' | 'png'; quality: number; watermark: Watermark | null; exif: ExifSummary; space: 'srgb' | 'p3'; stripGps: boolean };

let out: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;

/** 整数座標のハッシュ → 0..1（ディザ用、再現性のため決定的） */
function hash(x: number, y: number, c: number): number {
  let h = (x * 374761393 + y * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function writeTile(m: Extract<ExportWorkerRequest, { type: 'tile' }>): void {
  if (!out) throw new Error('begin が呼ばれていません');
  // シャープ用の余白を付けた範囲を縮小し、シャープをかけてから core だけを書く
  const ext = { x: Math.max(0, m.core.x - m.margin), y: Math.max(0, m.core.y - m.margin), w: 0, h: 0 };
  ext.w = Math.min(out.w, m.core.x + m.core.w + m.margin) - ext.x;
  ext.h = Math.min(out.h, m.core.y + m.core.h + m.margin) - ext.y;
  const rgb = resampleTile(m.rgba, m.frame, ext, m.sx, m.sy);
  unsharp(rgb, ext.w, ext.h, m.sharpen, Math.max(out.w, out.h));
  for (let y = 0; y < m.core.h; y++) for (let x = 0; x < m.core.w; x++) {
    const ox = m.core.x + x, oy = m.core.y + y;
    const s = ((oy - ext.y) * ext.w + ox - ext.x) * 3, d = (oy * out.w + ox) * 4;
    for (let c = 0; c < 3; c++) {
      const v = Math.min(1, Math.max(0, rgb[s + c]!));
      // 三角ディザ ±1LSB。白飛び・黒つぶれはディザしない（プレビューと同じ扱い）
      const n = v > 0.5 / 255 && v < 1 - 0.5 / 255 ? hash(ox, oy, c) + hash(oy, ox, c + 3) - 1 : 0;
      out.rgba[d + c] = Math.round(v * 255 + n);
    }
    out.rgba[d + 3] = 255;
  }
}

async function handle(m: ExportWorkerRequest): Promise<unknown> {
  switch (m.type) {
    case 'begin': out = { w: m.outW, h: m.outH, rgba: new Uint8ClampedArray(m.outW * m.outH * 4) }; return null;
    case 'tile': writeTile(m); return null;
    case 'finish': {
      if (!out) throw new Error('begin が呼ばれていません');
      const o = out; out = null;
      if (m.watermark) await applyWatermark(o.rgba, o.w, o.h, m.watermark);
      const bytes = await encode(o.rgba, o.w, o.h, m.format, m.quality);
      return withMetadata(bytes, m.format, m.exif, m.space, m.stripGps);
    }
  }
}

self.onmessage = async (ev: MessageEvent<ExportWorkerRequest>) => {
  const m = ev.data;
  try {
    const value = await handle(m);
    (self as unknown as Worker).postMessage({ id: m.id, ok: true, value }, value instanceof Uint8Array ? [value.buffer] : []);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
