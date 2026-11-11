import { test, expect } from 'vitest';
import { resolveOrientation } from '../../src/decode/orientation';

// 最終レビュー I5c: ブラウザが向きを適用したかを、ファイルごとに寸法で判定する
test('orientation 6 で EXIF の寸法と比べて縦横が入れ替わっていれば適用済み → 1', () =>
  expect(resolveOrientation({ exif: 6, exifDims: { w: 40, h: 20 }, bitmap: { w: 20, h: 40 }, probeApplies: false, heic: false })).toBe(1));
test('orientation 6 で寸法が同じなら未適用 → 6（プローブの結果より優先）', () =>
  expect(resolveOrientation({ exif: 6, exifDims: { w: 40, h: 20 }, bitmap: { w: 40, h: 20 }, probeApplies: true, heic: false })).toBe(6));
test('EXIF の寸法が無ければプローブの結果に従う', () => {
  expect(resolveOrientation({ exif: 8, exifDims: null, bitmap: { w: 20, h: 40 }, probeApplies: true, heic: false })).toBe(1);
  expect(resolveOrientation({ exif: 8, exifDims: null, bitmap: { w: 40, h: 20 }, probeApplies: false, heic: false })).toBe(8);
});
test('orientation 3（180°）は寸法で判定できないのでプローブに従う', () => {
  expect(resolveOrientation({ exif: 3, exifDims: { w: 40, h: 20 }, bitmap: { w: 40, h: 20 }, probeApplies: true, heic: false })).toBe(1);
  expect(resolveOrientation({ exif: 3, exifDims: { w: 40, h: 20 }, bitmap: { w: 40, h: 20 }, probeApplies: false, heic: false })).toBe(3);
});
test('HEIC は irot が必ず適用されるので常に 1', () =>
  expect(resolveOrientation({ exif: 6, exifDims: { w: 40, h: 20 }, bitmap: { w: 40, h: 20 }, probeApplies: false, heic: true })).toBe(1));
test('orientation 1 は 1', () =>
  expect(resolveOrientation({ exif: 1, exifDims: null, bitmap: { w: 4, h: 2 }, probeApplies: false, heic: false })).toBe(1));
