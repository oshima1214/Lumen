import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import { assetPath } from '../helpers/samples';
import type { DecodeHarness } from './harness/decode-harness';

const h = useHarness('tests/e2e/harness/decode-harness.ts', 'decode-harness-ready');
type W = { __decode: DecodeHarness };

test('sRGB 中間灰 JPEG はリニア 0.214±0.01 になる', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const img = await d.decodeDisplay(await d.file('fixtures/gray128.jpg'));
    const i = (32 * img.width + 32) * 3;
    return { kind: img.kind, w: img.width, h: img.height, px: [img.pixels[i]!, img.pixels[i + 1]!, img.pixels[i + 2]!].map((v) => v / 65535) };
  });
  expect(r.kind).toBe('display');
  expect([r.w, r.h]).toEqual([64, 64]);
  for (const v of r.px) expect(Math.abs(v - 0.2158)).toBeLessThan(0.01);
});

// 仕様 2.3 の契約: 画素と orientation の組が整合していること。ブラウザが向きを適用する場合は
// 正立画素（20x40、上半分が赤）と orientation 1、適用しない場合は保存画素（40x20、左半分が赤）と 6。
test('orientation 6 の JPEG は画素と orientation が整合する', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const img = await d.decodeDisplay(await d.file('fixtures/orient6.jpg'));
    const at = (x: number, y: number) => img.pixels[(y * img.width + x) * 3]! / 65535;
    return { o: img.orientation, w: img.width, h: img.height, storedLeft: at(5, 10), uprightTop: at(10, 5) };
  });
  if (r.o === 6) {
    expect([r.w, r.h]).toEqual([40, 20]);
    expect(r.storedLeft).toBeGreaterThan(0.5);
  } else {
    expect(r.o).toBe(1);
    expect([r.w, r.h]).toEqual([20, 40]);
    expect(r.uprightTop).toBeGreaterThan(0.5);
  }
});

test('PNG のカラーチャートの赤は R が最大', async ({ page }) => {
  await h.open(page);
  const px = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const img = await d.decodeDisplay(await d.file('fixtures/colorchart.png'));
    const i = (4 * img.width + 2) * 3;
    return [img.pixels[i]!, img.pixels[i + 1]!, img.pixels[i + 2]!];
  });
  expect(px[0]!).toBeGreaterThan(px[1]!);
  expect(px[0]!).toBeGreaterThan(px[2]!);
});

test('iPhone HEIC（test-assets/iphone.heic があれば）', async ({ page }) => {
  test.skip(!assetPath('iphone.heic'), 'test-assets/iphone.heic がない');
  await h.open(page);
  const r = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const img = await d.decodeHeic(await d.file('assets/iphone.heic'));
    return { w: img.width, h: img.height, kind: img.kind, model: img.exif.model ?? '' };
  });
  expect(r.kind).toBe('display');
  expect(r.w * r.h).toBeGreaterThan(1_000_000);
  expect(r.model).toMatch(/iPhone/);
});

test('合成 HEIC（libheif 経路）は寸法と中間灰を返す', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const img = await d.decodeHeic(await d.file('fixtures/gray128.heic'));
    const i = (24 * img.width + 32) * 3;
    return { w: img.width, h: img.height, o: img.orientation, g: img.pixels[i + 1]! / 65535 };
  });
  expect([r.w, r.h]).toEqual([64, 48]);
  expect(r.o).toBe(1);
  expect(Math.abs(r.g - 0.2158)).toBeLessThan(0.03);
});

// 最終レビュー I5a: iOS のキャンバス面積の上限に当たらないよう帯に分けて読む。帯の高さによらず同じ画素になること
test('帯に分けて読んでも 1 回で読んだのと同じ画素', async ({ page }) => {
  await h.open(page);
  const same = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    for (const p of ['fixtures/gradient.png', 'fixtures/pano9000.jpg']) {
      const f = await d.file(p);
      const a = await d.decodeDisplay(f), b = await d.decodeDisplay(f, { bandRows: 7 });
      if (a.width !== b.width || a.height !== b.height) return `${p}: size`;
      for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return `${p}: pixel ${i}`;
    }
    return 'same';
  });
  expect(same).toBe('same');
});

// 最終レビュー I5b: 埋め込みプロファイルの変換はブラウザに任せ、Display P3 として読む
test('P3 タグ付きの赤は sRGB の赤より彩度が高い（Rec.2020 の G 成分が小さい）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const d = (window as unknown as W).__decode;
    const g = async (p: string) => { const img = await d.decodeDisplay(await d.file(p)); return [0, 1, 2].map((c) => img.pixels[(8 * img.width + 8) * 3 + c]! / 65535); };
    return { p3: await g('fixtures/red-p3.jpg'), srgb: await g('fixtures/red-srgb.jpg') };
  });
  expect(r.p3[1]!).toBeLessThan(r.srgb[1]! - 0.02);
  expect(r.srgb[0]!).toBeGreaterThan(0.5);
});
