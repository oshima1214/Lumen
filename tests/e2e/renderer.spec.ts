import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import type { RendererHarness } from './harness/renderer-harness';

const h = useHarness('tests/e2e/harness/renderer-harness.ts', 'renderer-harness-ready');
type W = { __r: RendererHarness };

test('orientation 6 + 向き補正後の左半分の切り抜き: 上が赤・下が青（Review Focus 1）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { make, image, view, defaultParams } = (window as unknown as W).__r;
    const { r } = await make();
    // 保存画素 40x20: 左半分赤、右半分青。orientation 6（時計回り 90° で表示）→ 表示では上半分が赤
    await r.setImage(image(40, 20, 6, (x) => (x < 20 ? [1, 0, 0] : [0, 0, 1])));
    const p = defaultParams(); p.crop.w = 0.5;
    await r.renderNow(p, view(100, 400));
    const s = await r.snapshot();
    const at = (x: number, y: number) => Array.from(s.data.slice((y * s.w + x) * 4, (y * s.w + x) * 4 + 3));
    return { w: s.w, h: s.h, top: at(s.w >> 1, 2), bottom: at(s.w >> 1, s.h - 3) };
  });
  expect(r.w / r.h).toBeCloseTo(10 / 40, 1);
  expect(r.top[0]!).toBeGreaterThan(200); expect(r.top[2]!).toBeLessThan(50);
  expect(r.bottom[2]!).toBeGreaterThan(200); expect(r.bottom[0]!).toBeLessThan(50);
});

test('fit 表示は previewCap を超えない', async ({ page }) => {
  await h.open(page);
  const s = await page.evaluate(async () => {
    const { make, image, view, defaultParams } = (window as unknown as W).__r;
    const { r } = await make({ previewCap: 256 });
    await r.setImage(image(1024, 512, 1, () => [0.2, 0.2, 0.2]));
    await r.renderNow(defaultParams(), view(2000, 2000));
    const s = await r.snapshot();
    return { w: s.w, h: s.h };
  });
  expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(256);
  expect(s.w / s.h).toBeCloseTo(2, 1);
});

test('ヒストグラム: 一様な中間灰は bin 128 付近に集まり、白は白飛びとして数える', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { make, image, view, defaultParams } = (window as unknown as W).__r;
    const { r } = await make();
    await r.setImage(image(64, 64, 1, () => [0.2158, 0.2158, 0.2158]));
    await r.renderNow(defaultParams(), view(64, 64));
    const g = await r.histogram();
    const near = (a: Uint32Array) => a[127]! + a[128]! + a[129]!;
    const total = g.r.reduce((x, y) => x + y, 0);
    await r.setImage(image(32, 32, 1, () => [1, 1, 1]));
    await r.renderNow(defaultParams(), view(32, 32));
    const w = await r.histogram();
    return { near: [near(g.r), near(g.g), near(g.b)], total, clipHigh: w.clipHigh, clipLow: g.clipLow, whiteTotal: w.r.reduce((x, y) => x + y, 0) };
  });
  for (const n of r.near) expect(n).toBe(r.total);
  expect(r.clipLow).toBe(0);
  expect(r.clipHigh).toBe(r.whiteTotal);
});

test('上限を超える作業画像は GpuOutOfMemoryError', async ({ page }) => {
  await h.open(page);
  const isOom = await page.evaluate(async () => {
    const { make, image, isOom } = (window as unknown as W).__r;
    const { r, gpu } = await make();
    const w = gpu.limits.maxTextureDimension2D + 1;
    try { await r.setImage(image(w, 1, 1, () => [0, 0, 0])); return false; } catch (e) { return isOom(e); }
  });
  expect(isOom).toBe(true);
});

test('デバイス喪失のあと新しいデバイスで描画し直せる', async ({ page }) => {
  await h.open(page);
  const px = await page.evaluate(async () => {
    const { make, image, view, defaultParams } = (window as unknown as W).__r;
    const { r, gpu } = await make();
    await r.setImage(image(32, 32, 1, () => [0.5, 0.5, 0.5]));
    await r.renderNow(defaultParams(), view(32, 32));
    gpu.device.destroy();
    await r.whenReady();
    await r.renderNow(defaultParams(), view(32, 32));
    const s = await r.snapshot();
    return Array.from(s.data.slice(0, 3));
  });
  expect(px[0]!).toBeGreaterThan(100);
});

test('破棄した Renderer はデバイス喪失で復活しない（最終レビュー C1）', async ({ page }) => {
  await h.open(page);
  const n = await page.evaluate(async () => {
    const { make, image } = (window as unknown as W).__r;
    const { r, gpu, recreated } = await make();
    await r.setImage(image(32, 32, 1, () => [0.5, 0.5, 0.5]));
    r.destroy();
    gpu.device.destroy();
    await new Promise((ok) => setTimeout(ok, 300));
    return recreated.count;
  });
  expect(n).toBe(0);
});
