// Task 13: 現像シェーダー（WGSL）と TS 参照実装 developPixel の一致（全画素の最大差 ≤ 1/512）
import { test, expect, type Page } from '@playwright/test';
import { bundleHarness, openHarness, type HarnessFiles } from './harness/serve';
import type { EngineHarness, ParityCase } from './harness/engine-harness';
import { HSL_BANDS } from '../../src/params/types';

let files: HarnessFiles;
test.beforeAll(async () => { files = await bundleHarness('tests/e2e/harness/engine-harness.ts'); });
const open = (page: Page) => openHarness(page, files, 'engine-harness-ready');
type W = { __engine: EngineHarness };

// 合成カメラ（カメラ RGB → XYZ）と撮影時の中性点
const CAM_TO_XYZ = [0.62, 0.25, 0.08, 0.28, 0.82, -0.1, 0.02, 0.09, 0.95];
const RAW = { kind: 'raw' as const, camToXyz: CAM_TO_XYZ, asShotNeutral: [0.48, 1, 0.66] as [number, number, number] };

const cases: ParityCase[] = [
  { name: '既定値', params: {} },
  { name: '露光 +2', params: { basic: { exposure: 2 } } },
  { name: '露光 −3', params: { basic: { exposure: -3 } } },
  { name: 'コントラスト +80', params: { basic: { contrast: 80 } } },
  { name: 'コントラスト −80', params: { basic: { contrast: -80 } } },
  { name: '白 +60', params: { basic: { whites: 60 } } },
  { name: '白 −60', params: { basic: { whites: -60 } } },
  { name: '黒 +60', params: { basic: { blacks: 60 } } },
  { name: '黒 −60', params: { basic: { blacks: -60 } } },
  { name: '自然な彩度 +80', params: { basic: { vibrance: 80 } } },
  { name: '彩度 −100', params: { basic: { saturation: -100 } } },
  ...HSL_BANDS.flatMap((band) => (['h', 's', 'l'] as const).flatMap((k) => [60, -60].map((v) => ({
    name: `HSL ${band}.${k} ${v}`, params: { hsl: { [band]: { [k]: v } } },
  })))),
  ...[0, 100].map((blending) => ({
    name: `グレーディング blending ${blending}`,
    params: {
      grading: {
        shadows: { hue: 220, sat: 60, lum: -30 }, midtones: { hue: 40, sat: 35, lum: 20 },
        highlights: { hue: 60, sat: 70, lum: 40 }, blending, balance: 0,
      },
    },
  })),
  { name: 'RGB ポイントカーブ S 字', params: { curve: { rgb: [[0, 0], [0.25, 0.18], [0.5, 0.5], [0.75, 0.84], [1, 1]] } } },
  { name: 'R カーブのみ', params: { curve: { r: [[0, 0], [0.4, 0.55], [1, 1]] } } },
  { name: 'RAW 撮影時', params: {}, img: RAW },
  { name: 'RAW custom 3200K', params: { wb: { mode: 'custom', temp: 3200, tint: 0 } }, img: RAW },
  { name: 'display 相対 WB +50,−30', params: { wb: { mode: 'custom', temp: 50, tint: -30 } } },
  { name: '出力 P3', params: {}, out: 'p3' },
  { name: '複合', params: { basic: { exposure: 0.7, contrast: 35, whites: -20, blacks: 15, vibrance: 30, saturation: 10 },
    curve: { parametric: { highlights: -30, lights: 20, darks: 10, shadows: -15, splits: [0.25, 0.5, 0.75] } } } },
];

test('GPU と developPixel の最大差 ≤ 1/512（全ケース）', async ({ page }) => {
  test.setTimeout(120_000);
  await open(page);
  const results = await page.evaluate((cs) => (window as unknown as W).__engine.developParity(cs), cases);
  expect(results.length).toBe(cases.length);
  const bad = results.filter((r) => !(r.maxErr <= 1 / 512));
  for (const r of results) console.log(`${r.name}: ${(r.maxErr * 512).toFixed(3)}/512 @${r.at}`);
  expect(bad, JSON.stringify(bad)).toEqual([]);
});

test('outRect の外は書かない・恒等 SampleTransform は入力画素の中心を読む', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => (window as unknown as W).__engine.developRect());
  expect(r.outsideUntouched).toBe(true);
  expect(r.insideMaxErr).toBeLessThanOrEqual(1 / 512);
});

// Task 14: ベース層を使う処理段 4（ベース層は GPU・参照実装とも baseLayerRef の値を使う）
test('ハイライト／シャドウ ±80 のパリティ（ベース層は両方とも baseLayerRef）', async ({ page }) => {
  await open(page);
  const cases = [
    { name: 'ハイライト +80', params: { basic: { highlights: 80 } }, refBase: true },
    { name: 'ハイライト −80', params: { basic: { highlights: -80 } }, refBase: true },
    { name: 'シャドウ +80', params: { basic: { shadows: 80 } }, refBase: true },
    { name: 'シャドウ −80', params: { basic: { shadows: -80 } }, refBase: true },
    { name: 'ハイライト −80 シャドウ +80 露光 +1', params: { basic: { highlights: -80, shadows: 80, exposure: 1 } }, refBase: true },
    { name: 'RAW ハイライト −80 シャドウ +80', params: { basic: { highlights: -80, shadows: 80 } }, img: RAW, refBase: true },
  ];
  const results = await page.evaluate((cs) => (window as unknown as W).__engine.developParity(cs), cases);
  for (const r of results) console.log(`${r.name}: ${(r.maxErr * 512).toFixed(3)}/512 @${r.at}`);
  expect(results.filter((r) => !(r.maxErr <= 1 / 512))).toEqual([]);
});
