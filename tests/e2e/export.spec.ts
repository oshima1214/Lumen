import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import type { ExportHarness } from './harness/export-harness';

const h = useHarness('tests/e2e/harness/export-harness.ts', 'export-harness-ready');
type W = { __x: ExportHarness };
test.describe.configure({ timeout: 180_000 });

const settings = {
  format: 'jpeg' as const, quality: 85, longEdge: 1024, space: 'srgb' as const, sharpen: 'standard' as const,
  nameRule: '{name}_{seq}', watermark: { kind: 'text' as const, text: '© Lumen', position: 'br' as const, size: 0.05, opacity: 0.6 }, stripGps: true,
};

test('壊れたファイルを含む 2 枚: 1 枚保存・1 枚失敗、長辺 1024 の JPEG（Review Focus 5）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async (s) => {
    const { file, run } = (window as unknown as W).__x;
    const broken = new File([Uint8Array.from({ length: 4096 }, (_, i) => (i * 13) % 256)], 'BROKEN.NEF');
    return run([await file('fixtures/pano9000.jpg'), broken], s);
  }, settings);
  expect(r.res.saved).toEqual(['pano9000_001.jpg']);
  expect(r.res.failed.map((f) => f.id)).toEqual(['id1']);
  expect(r.res.cancelled).toBe(false);
  expect(r.out[0]!.type).toBe('image/jpeg');
  expect([r.out[0]!.w, r.out[0]!.h]).toEqual([1024, 114]);
  expect(r.out[0]!.icc).toMatch(/sRGB/);
  expect(r.progress.at(-1)).toBe(2);
});

test('3 枚目の開始前に中止すると cancelled、保存は 2 件', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async (s) => {
    const { file, run } = (window as unknown as W).__x;
    const fs = [await file('fixtures/gray128.jpg', 'a.jpg'), await file('fixtures/gradient.png', 'b.png'), await file('fixtures/colorchart.png', 'c.png')];
    return run(fs, { ...s, format: 'png' as const, longEdge: null, watermark: null }, 2);
  }, settings);
  expect(r.res.cancelled).toBe(true);
  expect(r.res.saved).toEqual(['a_001.png', 'b_002.png']);
  expect(r.out.map((o) => [o.w, o.h])).toEqual([[64, 64], [256, 16]]);
});
