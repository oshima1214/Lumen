import { test, expect } from 'vitest';
import { resampleTile } from '../../src/export/resample';

test('等倍（sx=sy=1）は frame から core をそのまま切り出す', () => {
  const fw = 4, fh = 3;
  const src = new Float32Array(fw * fh * 4).map((_, i) => i);
  const out = resampleTile(src, { x: 10, y: 20, w: fw, h: fh }, { x: 11, y: 21, w: 2, h: 1 }, 1, 1);
  // 出力 (11,21) = frame (1,1)、(12,21) = frame (2,1)
  expect(Array.from(out)).toEqual([src[(1 * fw + 1) * 4]!, src[(1 * fw + 1) * 4 + 1]!, src[(1 * fw + 1) * 4 + 2]!,
    src[(1 * fw + 2) * 4]!, src[(1 * fw + 2) * 4 + 1]!, src[(1 * fw + 2) * 4 + 2]!]);
});

test('一様画像の縮小は値が変わらない', () => {
  const fw = 40, fh = 40;
  const src = new Float32Array(fw * fh * 4).fill(0.4);
  const out = resampleTile(src, { x: -10, y: -10, w: fw, h: fh }, { x: 0, y: 0, w: 5, h: 5 }, 2, 2);
  for (const v of out) expect(v).toBeCloseTo(0.4, 5);
});

test('1/2 縮小で白点のエネルギーが保存される（±1%）', () => {
  const fw = 64, fh = 64;
  const src = new Float32Array(fw * fh * 4);
  const i = (32 * fw + 32) * 4; src[i] = src[i + 1] = src[i + 2] = 1;
  const out = resampleTile(src, { x: 0, y: 0, w: fw, h: fh }, { x: 8, y: 8, w: 16, h: 16 }, 2, 2);
  let sum = 0; for (let k = 0; k < out.length; k += 3) sum += out[k]!;
  expect(sum * 4).toBeGreaterThan(0.99);   // 出力 1px = 入力 4px
  expect(sum * 4).toBeLessThan(1.01);
});
