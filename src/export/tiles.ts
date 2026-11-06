// 書き出しのタイル計画（仕様 3.4）。原寸のフレーム（切り抜き後の画像）をタイルごとに GPU で現像し、
// 出力サイズへ Lanczos 縮小する。タイルは「出力の core 範囲」ごとに作り、描画範囲（frame）は core に
// 縮小フィルタの支持幅ぶんの余白を足したもの（長辺 TILE 以下）。src はその frame の描画に要る保存画素の範囲。
import { frameMatrix, orientedSize } from '../engine/geometry';
import type { Rect } from '../engine/develop';
import type { Orientation } from '../decode/types';
import type { DevelopParams } from '../params/types';

export const TILE = 2048, OVERLAP = 32;

export interface TilePlan {
  /** 描画するフレーム範囲（原寸の切り抜き後画像の画素座標、余白込み） */
  frame: Rect;
  /** frame の描画に要る保存画素（向き補正前）の範囲。画像外は readTile が端の画素で埋める */
  src: Rect;
  /** この タイルが出力に書く範囲（出力画素座標） */
  core: Rect;
}

export function planTiles(full: { w: number; h: number; o: Orientation }, crop: DevelopParams['crop'],
  outLongEdge: number | null, opts: { tile?: number; overlap?: number } = {}): { outW: number; outH: number; scale: number; tiles: TilePlan[] } {
  const tile = opts.tile ?? TILE, overlap = opts.overlap ?? OVERLAP;
  const O = orientedSize(full.w, full.h, full.o);
  const CW = crop.w * O.w, CH = crop.h * O.h;
  const s = outLongEdge ? Math.min(1, outLongEdge / Math.max(CW, CH)) : 1;
  const outW = Math.max(1, Math.round(CW * s)), outH = Math.max(1, Math.round(CH * s));
  const sx = CW / outW, sy = CH / outH;                     // 出力 1px あたりのフレーム px
  const m = Math.max(overlap, Math.ceil(3 * Math.max(sx, sy)) + 2);   // Lanczos-3 の支持幅＋余裕
  const coreW = Math.max(1, Math.floor((tile - 2 * m) / sx)), coreH = Math.max(1, Math.floor((tile - 2 * m) / sy));
  const fm = frameMatrix(full, crop);
  const toStored = (x: number, y: number): [number, number] => {
    const w = fm[6]! * x + fm[7]! * y + fm[8]!;
    return [((fm[0]! * x + fm[1]! * y + fm[2]!) / w) * full.w, ((fm[3]! * x + fm[4]! * y + fm[5]!) / w) * full.h];
  };
  const tiles: TilePlan[] = [];
  for (let oy = 0; oy < outH; oy += coreH) for (let ox = 0; ox < outW; ox += coreW) {
    const core = { x: ox, y: oy, w: Math.min(coreW, outW - ox), h: Math.min(coreH, outH - oy) };
    const x0 = Math.floor(core.x * sx) - m, y0 = Math.floor(core.y * sy) - m;
    const x1 = Math.ceil((core.x + core.w) * sx) + m, y1 = Math.ceil((core.y + core.h) * sy) + m;
    const frame = { x: x0, y: y0, w: Math.min(tile, x1 - x0), h: Math.min(tile, y1 - y0) };
    const pts = [toStored(frame.x, frame.y), toStored(frame.x + frame.w, frame.y), toStored(frame.x, frame.y + frame.h), toStored(frame.x + frame.w, frame.y + frame.h)];
    const minX = Math.floor(Math.min(...pts.map((q) => q[0]))) - 2, minY = Math.floor(Math.min(...pts.map((q) => q[1]))) - 2;
    const maxX = Math.ceil(Math.max(...pts.map((q) => q[0]))) + 2, maxY = Math.ceil(Math.max(...pts.map((q) => q[1]))) + 2;
    tiles.push({ frame, core, src: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
  }
  return { outW, outH, scale: 1 / Math.max(sx, sy), tiles };
}
