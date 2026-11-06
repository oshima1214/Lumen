import { test, expect } from 'vitest';
import { BASE_LAYER_EDGE, baseLayerRadius, baseLayerRef, linearStages } from '../../src/color/pipeline';
import { buildUniforms } from '../../src/color/uniforms';
import { defaultParams } from '../../src/params/defaults';
import { deepMerge } from '../../src/params/partial';
import type { DevelopParams } from '../../src/params/types';

test('BASE_LAYER_EDGE = 512、半径は長辺の 2%', () => {
  expect(BASE_LAYER_EDGE).toBe(512);
  expect(baseLayerRadius(512, 384)).toBe(10);
  expect(baseLayerRadius(64, 64)).toBe(1);
  expect(baseLayerRadius(10, 4)).toBe(1);
});

test('一様画像でベース層 = 入力輝度', () => {
  for (const v of [0.003, 0.18, 0.9, 3]) {
    const w = 40, h = 30;
    const out = baseLayerRef(new Float32Array(w * h).fill(v), w, h);
    expect(out.length).toBe(w * h);
    for (const o of out) expect(Math.abs(o - v)).toBeLessThan(1e-3);
  }
});

test('ステップエッジで両側の平坦部（エッジから半径×2 以上）はそれぞれの輝度', () => {
  const w = 200, h = 50, e = 100, lo = 0.02, hi = 0.7;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = x < e ? lo : hi;
  const r = baseLayerRadius(w, h);
  expect(r).toBe(4);
  const out = baseLayerRef(lum, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x <= e - 1 - 2 * r) expect(Math.abs(out[y * w + x]! - lo)).toBeLessThan(1e-3);
    if (x >= e + 2 * r) expect(Math.abs(out[y * w + x]! - hi)).toBeLessThan(1e-3);
  }
  // エッジを保つ（ガイデッドフィルター）: エッジのすぐ両側でも元の値に近く、単純なぼかしの平均（≈0.36）にはならない
  expect(out[25 * w + e - 1]!).toBeLessThan(0.1);
  expect(out[25 * w + e]!).toBeGreaterThan(0.4);
});

test('linearStages は developPixel の処理段 1〜3（display は WB 行列 × 露光）', () => {
  const p = deepMerge<DevelopParams>(defaultParams(), { basic: { exposure: 1 } });
  const { u } = buildUniforms(p, { kind: 'display' }, 'srgb');
  const o = linearStages([0.1, 0.2, 0.3], u);
  [0.2, 0.4, 0.6].forEach((v, i) => expect(o[i]).toBeCloseTo(v, 12));
});
