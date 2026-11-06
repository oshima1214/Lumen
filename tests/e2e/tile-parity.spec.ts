import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import type { TilesHarness } from './harness/tiles-harness';

const h = useHarness('tests/e2e/harness/tiles-harness.ts', 'tiles-harness-ready');
type W = { __t: TilesHarness };
test.describe.configure({ timeout: 180_000 });

test('9000x1000 を原寸タイル書き出し: 出力 9000x1000、タイル境界に段差がない（Review Focus 4）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { developTiled, defaultParams } = (window as unknown as W).__t;
    const p = defaultParams(); p.basic.highlights = -60; p.basic.shadows = 40; p.basic.exposure = 0.3;
    const { w, h, out, xs } = await developTiled(9000, 1000, 2048, p);
    const boundaries = new Set(xs.filter((x) => x > 0));
    let maxIn = 0, maxAt = 0;
    for (let y = 0; y < h; y += 7) for (let x = 1; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(out[(y * w + x) * 3 + c]! - out[(y * w + x - 1) * 3 + c]!);
        if (boundaries.has(x)) maxAt = Math.max(maxAt, d); else maxIn = Math.max(maxIn, d);
      }
    }
    return { w, h, tiles: xs.length, maxIn, maxAt };
  });
  expect([r.w, r.h]).toEqual([9000, 1000]);
  expect(r.tiles).toBeGreaterThan(1);
  expect(r.maxAt).toBeLessThanOrEqual(r.maxIn + 1 / 255);
});

test('3000x2000: タイル分割と 1 枚現像の最大差 ≤ 1/255', async ({ page }) => {
  await h.open(page);
  const diff = await page.evaluate(async () => {
    const { developTiled, defaultParams } = (window as unknown as W).__t;
    const p = defaultParams(); p.basic.highlights = -80; p.basic.contrast = 30; p.crop.angle = 5; p.crop.x = 0.1; p.crop.y = 0.1; p.crop.w = 0.8; p.crop.h = 0.8;
    const a = await developTiled(3000, 2000, 700, p);
    const b = await developTiled(3000, 2000, 4096, p);
    let m = 0;
    for (let i = 0; i < a.out.length; i++) m = Math.max(m, Math.abs(a.out[i]! - b.out[i]!));
    return { m, tilesA: a.xs.length, tilesB: b.xs.length };
  });
  expect(diff.tilesA).toBeGreaterThan(1);
  expect(diff.tilesB).toBe(1);
  expect(diff.m).toBeLessThanOrEqual(1 / 255);
});
