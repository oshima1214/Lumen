// Task 12: GPU 初期化・作業画像のアップロード・ピラミッド（chromium-webgpu）
import { test, expect, type Page } from '@playwright/test';
import { bundleHarness, openHarness, type HarnessFiles } from './harness/serve';
import type { EngineHarness } from './harness/engine-harness';

let files: HarnessFiles;
test.beforeAll(async () => { files = await bundleHarness('tests/e2e/harness/engine-harness.ts'); });

const open = (page: Page) => openHarness(page, files, 'engine-harness-ready');
type W = { __engine: EngineHarness };

test('5×3 のグラデーションを upload → readTexture が /65535 と 1e-3 以内', async ({ page }) => {
  await open(page);
  const data: number[] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
    data.push(Math.round((x / 4) * 65535), Math.round((y / 2) * 65535), Math.round(((x + y) / 6) * 65535));
  }
  const r = await page.evaluate((d) => (window as unknown as W).__engine.uploadAndRead(d, 5, 3, 0), data);
  expect(r.format).toBe('rgba16float');
  expect(r.pixels.length).toBe(5 * 3 * 4);
  for (let i = 0; i < 15; i++) {
    for (let c = 0; c < 3; c++) expect(Math.abs(r.pixels[i * 4 + c]! - data[i * 3 + c]! / 65535)).toBeLessThan(1e-3);
    expect(r.pixels[i * 4 + 3]).toBe(1);
  }
});

test('行を分けて送っても同じ値（1 行ずつ、奇数個の値）', async ({ page }) => {
  await open(page);
  const data: number[] = [];
  for (let i = 0; i < 5 * 3 * 3; i++) data.push((i * 4099) % 65536);
  const r = await page.evaluate((d) => (window as unknown as W).__engine.uploadAndRead(d, 5, 3, 0, 30), data);
  for (let i = 0; i < 15; i++) {
    for (let c = 0; c < 3; c++) expect(Math.abs(r.pixels[i * 4 + c]! - data[i * 3 + c]! / 65535)).toBeLessThan(1e-3);
  }
});

test('mipCount は floor(log2(max(w,h)))+1', async ({ page }) => {
  await open(page);
  for (const [w, h] of [[5, 3], [64, 64], [1, 1], [300, 17], [1024, 768]] as const) {
    const r = await page.evaluate(([ww, hh]) => (window as unknown as W).__engine.uploadInfo(ww, hh), [w, h] as const);
    const expected = Math.floor(Math.log2(Math.max(w, h))) + 1;
    expect(r.mipCount).toBe(expected);
    expect(r.texMips).toBe(expected);
  }
});

test('64×64 一様画像の最小ミップが同じ値', async ({ page }) => {
  await open(page);
  const v = [12345, 40000, 777];
  const data: number[] = [];
  for (let i = 0; i < 64 * 64; i++) data.push(...v);
  const r = await page.evaluate((d) => (window as unknown as W).__engine.uploadAndRead(d, 64, 64), data);
  expect(r.mipCount).toBe(7);
  expect(r.pixels.length).toBe(4);
  for (let c = 0; c < 3; c++) expect(Math.abs(r.pixels[c]! - v[c]! / 65535)).toBeLessThan(1e-3);
});

test('奇数サイズでもミップは 2×2 平均（一様なら値を保つ）', async ({ page }) => {
  await open(page);
  const data = new Array<number>(37 * 21 * 3).fill(30000);
  const r = await page.evaluate((d) => (window as unknown as W).__engine.uploadAndRead(d, 37, 21, 2), data);
  expect(r.pixels.length).toBe(9 * 5 * 4);
  for (let i = 0; i < 45; i++) expect(Math.abs(r.pixels[i * 4]! - 30000 / 65535)).toBeLessThan(1e-3);
});
