// タイル分割現像の E2E 入口（本番バンドル外）。readTile の代わりに、手元のフル解像度配列から切り出す。
import { Renderer } from '../../../src/engine/renderer';
import { createGpu } from '../../../src/engine/gpu';
import { planTiles } from '../../../src/export/tiles';
import { downscaleArea } from '../../../src/decode/downscale';
import { defaultParams } from '../../../src/params/defaults';
import type { DevelopParams } from '../../../src/params/types';
import type { Rect } from '../../../src/engine/develop';

function cut(full: Uint16Array, W: number, H: number, r: Rect): Uint16Array {
  const out = new Uint16Array(r.w * r.h * 3);
  for (let y = 0; y < r.h; y++) {
    const sy = Math.min(H - 1, Math.max(0, r.y + y));
    for (let x = 0; x < r.w; x++) {
      const sx = Math.min(W - 1, Math.max(0, r.x + x)), s = (sy * W + sx) * 3, d = (y * r.w + x) * 3;
      out[d] = full[s]!; out[d + 1] = full[s + 1]!; out[d + 2] = full[s + 2]!;
    }
  }
  return out;
}

/** W×H のグラデーション画像をタイル（tile px）で原寸現像し、出力（RGB float、出力画素順）を返す */
async function developTiled(W: number, H: number, tile: number, p: DevelopParams) {
  const full = new Uint16Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3; const v = x / (W - 1), w = y / (H - 1);
    full[i] = Math.round(v * 65535); full[i + 1] = Math.round((0.3 + 0.4 * w) * 65535); full[i + 2] = Math.round((1 - v) * 0.8 * 65535);
  }
  const small = downscaleArea(full, W, H, 4096);
  const canvas = document.createElement('canvas');
  const r = new Renderer(await createGpu(), canvas, { previewCap: 2048, outSpace: 'srgb' });
  await r.setImage({ width: small.width, height: small.height, fullWidth: W, fullHeight: H, orientation: 1, kind: 'display', pixels: small.data, exif: {} });
  const plan = planTiles({ w: W, h: H, o: 1 }, p.crop, null, { tile });
  const out = new Float32Array(plan.outW * plan.outH * 3);
  for (const t of plan.tiles) {
    const rgba = await r.renderTileFull(p, { data: cut(full, W, H, t.src), rect: t.src }, t.frame, 'srgb');
    // 原寸なので frame と出力は 1:1。core の範囲だけ書く
    for (let y = 0; y < t.core.h; y++) for (let x = 0; x < t.core.w; x++) {
      const fx = t.core.x + x - t.frame.x, fy = t.core.y + y - t.frame.y;
      const s = (fy * t.frame.w + fx) * 4, d = ((t.core.y + y) * plan.outW + t.core.x + x) * 3;
      out[d] = rgba[s]!; out[d + 1] = rgba[s + 1]!; out[d + 2] = rgba[s + 2]!;
    }
  }
  r.destroy();
  return { w: plan.outW, h: plan.outH, out, xs: plan.tiles.map((t) => t.core.x) };
}

const api = { developTiled, defaultParams };
export type TilesHarness = typeof api;
(window as unknown as { __t: TilesHarness }).__t = api;
document.title = 'tiles-harness-ready';
