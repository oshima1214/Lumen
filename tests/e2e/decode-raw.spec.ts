import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import { samplePath } from '../helpers/samples';
import type { DecodeHarness } from './harness/decode-harness';

const h = useHarness('tests/e2e/harness/decode-harness.ts', 'decode-harness-ready');
type W = { __decode: DecodeHarness };
type Summary = Awaited<ReturnType<DecodeHarness['rawSummary']>>;

async function summary(page: import('@playwright/test').Page, key: string, ext: string): Promise<Summary> {
  await h.open(page);
  return page.evaluate((p) => (window as unknown as W).__decode.rawSummary(p), `samples/${key}.${ext}`);
}
function common(s: Summary, opts: { preview: boolean } = { preview: true }) {
  expect(s.kind).toBe('raw');
  // カラーマトリクスの向き・撮影時 WB の検算: 撮影時の光源が現実的な色温度になる
  expect(s.asShot!.cct).toBeGreaterThan(2500);
  expect(s.asShot!.cct).toBeLessThan(10000);
  expect(s.max).toBeLessThanOrEqual(65535);
  expect(s.centerMean).toBeGreaterThan(0);
  if (opts.preview) expect(s.previewHead).toEqual([0xff, 0xd8, 0xff]);
  expect(s.camToXyz?.length).toBe(9);
  expect(s.neutral?.[1]).toBe(1);
}

test.describe.configure({ timeout: 120_000 });

test('Canon EOS 20D の CR2', async ({ page }) => {
  test.skip(!samplePath('canon-20d-cr2'), 'npm run samples で取得');
  const s = await summary(page, 'canon-20d-cr2', 'cr2');
  common(s);
  // LibRaw は周辺の有効画素も出力するため、公称 3504x2336 から数十 px 大きくなる
  expect(Math.abs(s.w - 3504)).toBeLessThanOrEqual(40);
  expect(Math.abs(s.h - 2336)).toBeLessThanOrEqual(40);
  expect(s.model).toMatch(/20D/);
});

test('Nikon D5200 の NEF（D5300 の代替）', async ({ page }) => {
  test.skip(!samplePath('nikon-d5200-nef'), 'npm run samples で取得');
  const s = await summary(page, 'nikon-d5200-nef', 'nef');
  common(s);
  expect(Math.abs(Math.max(s.w, s.h) - 6000)).toBeLessThanOrEqual(40);
  expect(s.model).toMatch(/D5200/);
});

test('iPhone 12 Pro の ProRAW（リニア DNG）', async ({ page }) => {
  test.skip(!samplePath('iphone-proraw-dng'), 'npm run samples で取得');
  const s = await summary(page, 'iphone-proraw-dng', 'dng');
  common(s);
  expect(s.w * s.h).toBeGreaterThan(10_000_000);
  expect(s.model).toMatch(/iPhone/);
});

test('iPhone のベイヤー DNG', async ({ page }) => {
  test.skip(!samplePath('bayer-dng'), 'npm run samples で取得');
  const s = await summary(page, 'bayer-dng', 'dng');
  common(s, { preview: false });   // サードパーティ製アプリの DNG は JPEG プレビューを持たない（null を返す）
  expect(s.model).toMatch(/iPhone/);
});

test('壊れた CR2 は Error で reject する（クラッシュしない）', async ({ page }) => {
  await h.open(page);
  const bytes = Array.from({ length: 1024 }, (_, i) => (i * 7919 + 13) % 256);
  const err = await page.evaluate(([b, n]) => (window as unknown as W).__decode.rawError(b as number[], n as string), [bytes, 'BROKEN.CR2'] as const);
  expect(err).not.toBeNull();
});
