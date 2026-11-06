// Task 14: 局所トーン（ハイライト／シャドウ用ベース層）
import { test, expect, type Page } from '@playwright/test';
import { bundleHarness, openHarness, type HarnessFiles } from './harness/serve';
import type { EngineHarness } from './harness/engine-harness';

let files: HarnessFiles;
test.beforeAll(async () => { files = await bundleHarness('tests/e2e/harness/engine-harness.ts'); });
const open = (page: Page) => openHarness(page, files, 'engine-harness-ready');
type W = { __engine: EngineHarness };

const RAW = { kind: 'raw' as const, camToXyz: [0.62, 0.25, 0.08, 0.28, 0.82, -0.1, 0.02, 0.09, 0.95], asShotNeutral: [0.48, 1, 0.66] as [number, number, number] };

test('GPU ベース層と baseLayerRef が 1/256 以内（長辺 512、WB・露光を適用）', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  for (const c of [
    { w: 1024, h: 768, params: {}, img: { kind: 'display' as const } },
    { w: 1024, h: 768, params: { basic: { exposure: 0.8 }, wb: { mode: 'custom' as const, temp: 30, tint: 10 } }, img: { kind: 'display' as const } },
    { w: 768, h: 1024, params: { basic: { exposure: -1 } }, img: RAW },
    { w: 300, h: 200, params: {}, img: { kind: 'display' as const } },
  ]) {
    const r = await page.evaluate((cc) => (window as unknown as W).__engine.baseLayerParity(cc.w, cc.h, cc.params, cc.img), c);
    const expectSize = Math.max(c.w, c.h) > 512 ? [c.w > c.h ? 512 : 384, c.w > c.h ? 384 : 512] : [c.w, c.h];
    expect([r.width, r.height]).toEqual(expectSize);
    console.log(`${c.w}×${c.h} mip ${r.mip}: ${(r.maxErr * 256).toFixed(4)}/256 @${r.at}`);
    expect(r.format).toBe('r32float');
    expect(r.maxErr, JSON.stringify(r)).toBeLessThanOrEqual(1 / 256);
  }
});

test('highlights −100 で明部が下がり暗部（輝度 < 0.05）は不変、shadows +100 で逆', async ({ page }) => {
  await open(page);
  const h = await page.evaluate(() => (window as unknown as W).__engine.localToneEffect({ basic: { highlights: -100 } }));
  console.log(JSON.stringify({ h }));
  expect(h.darkMaxDiff).toBeLessThanOrEqual(1 / 512);
  expect(h.brightMeanDiff).toBeLessThan(-0.05);
  const s = await page.evaluate(() => (window as unknown as W).__engine.localToneEffect({ basic: { shadows: 100 } }));
  console.log(JSON.stringify({ s }));
  expect(s.brightMaxDiff).toBeLessThanOrEqual(1 / 512);
  expect(s.darkMeanDiff).toBeGreaterThan(0.05);
});
