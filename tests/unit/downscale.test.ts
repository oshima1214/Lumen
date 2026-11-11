import { test, expect } from 'vitest';
import { downscaleArea } from '../../src/decode/downscale';

const uniform = (w: number, h: number, v: number) => new Uint16Array(w * h * 3).fill(v);

test('9000x1000 を 4096 に縮小すると 4096x455', () => {
  const r = downscaleArea(uniform(9000, 1000, 1000), 9000, 1000, 4096);
  expect([r.width, r.height]).toEqual([4096, 455]);
  expect(r.data.length).toBe(4096 * 455 * 3);
});
test('8064x6048（48MP）を 4096 に縮小すると 4096x3072', () => {
  const r = downscaleArea(uniform(8064, 6048, 7), 8064, 6048, 4096);
  expect([r.width, r.height]).toEqual([4096, 3072]);
});
test('一様画像は値が変わらない', () => {
  const r = downscaleArea(uniform(301, 200, 12345), 301, 200, 100);
  expect(r.data.every((v) => v === 12345)).toBe(true);
});
test('上限以下ならそのまま返す', () => {
  const src = uniform(10, 5, 3);
  const r = downscaleArea(src, 10, 5, 4096);
  expect(r.data).toBe(src);
  expect([r.width, r.height]).toEqual([10, 5]);
});
test('面積平均: 2x1 の [0, 1000] を 1x1 にすると 500', () => {
  const src = new Uint16Array([0, 0, 0, 1000, 1000, 1000]);
  const r = downscaleArea(src, 2, 1, 1);
  expect(Array.from(r.data)).toEqual([500, 500, 500]);
});
