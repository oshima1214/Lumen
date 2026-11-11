import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import { samplePath } from '../helpers/samples';
import type { DecoderHarness } from './harness/decoder-harness';

const h = useHarness('tests/e2e/harness/decoder-harness.ts', 'decoder-harness-ready');
type W = { __dec: DecoderHarness };
test.describe.configure({ timeout: 120_000 });

test('9000x1000 を workCap 4096 で開くと作業画像は 4096 幅、元データは 9000 幅', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const f = await file('fixtures/pano9000.jpg');
    const { handle, working } = await decoder.open(f, f.name, { workCap: 4096 });
    const tile = await decoder.readTile(handle, { x: 8990, y: 0, w: 20, h: 4 });
    // 範囲外（x >= 9000）は端の画素で埋まる: 行 0 の最後の 10 画素は x=8999 の値と同じ
    const last = tile[(0 * 20 + 9) * 3]!;
    const outside = Array.from({ length: 10 }, (_, i) => tile[(0 * 20 + 10 + i) * 3]!);
    return { w: working.width, h: working.height, fw: working.fullWidth, fh: working.fullHeight,
      len: tile.length, px: working.pixels.length, sameAsEdge: outside.every((v) => v === last) };
  });
  expect([r.w, r.h, r.fw, r.fh]).toEqual([4096, 455, 9000, 1000]);
  expect(r.px).toBe(4096 * 455 * 3);
  expect(r.len).toBe(20 * 4 * 3);
  expect(r.sameAsEdge).toBe(true);
});

test('2 枚目を開くと 1 枚目の handle は使えない', async ({ page }) => {
  await h.open(page);
  const err = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const a = await file('fixtures/gray128.jpg');
    const b = await file('fixtures/colorchart.png');
    const first = await decoder.open(a, a.name, { workCap: 4096 });
    await decoder.open(b, b.name, { workCap: 4096 });
    try { await decoder.readTile(first.handle, { x: 0, y: 0, w: 1, h: 1 }); return null; } catch (e) { return String(e); }
  });
  expect(err).not.toBeNull();
});

test('壊れた .NEF は DecodeError、その後も Worker は正常（Review Focus 5）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file, isDecodeError } = (window as unknown as W).__dec;
    const junk = new File([Uint8Array.from({ length: 2048 }, (_, i) => (i * 31 + 7) % 256)], 'DSC_0001.NEF');
    let isDec = false, format = '';
    try { await decoder.open(junk, junk.name, { workCap: 4096 }); } catch (e) { isDec = isDecodeError(e); format = (e as { format?: string }).format ?? ''; }
    const ok = await file('fixtures/gray128.jpg');
    const { working } = await decoder.open(ok, ok.name, { workCap: 4096 });
    return { isDec, format, w: working.width };
  });
  expect(r.isDec).toBe(true);
  expect(r.format).toBe('unknown');
  expect(r.w).toBe(64);
});

test('preview: JPEG は長辺 maxEdge 以下の JPEG を返す', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const f = await file('fixtures/pano9000.jpg');
    const blob = await decoder.preview(f, f.name, 320);
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, w: bmp.width, h: bmp.height };
  });
  expect(r.type).toBe('image/jpeg');
  expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(320);
});

test('preview: JPEG プレビューを持たない DNG でも縮小 JPEG を返す', async ({ page }) => {
  test.skip(!samplePath('bayer-dng'), 'npm run samples で取得');
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const f = await file('samples/bayer-dng.dng');
    const blob = await decoder.preview(f, f.name, 320);
    const bmp = await createImageBitmap(blob);
    return { type: blob.type, long: Math.max(bmp.width, bmp.height) };
  });
  expect(r.type).toBe('image/jpeg');
  expect(r.long).toBeLessThanOrEqual(320);
  expect(r.long).toBeGreaterThan(100);
});

test('RAW を開くと kind raw の作業画像と camToXyz', async ({ page }) => {
  test.skip(!samplePath('canon-20d-cr2'), 'npm run samples で取得');
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const f = await file('samples/canon-20d-cr2.cr2');
    const { working } = await decoder.open(f, f.name, { workCap: 2048 });
    return { kind: working.kind, long: Math.max(working.width, working.height), m: working.camToXyz?.length ?? 0 };
  });
  expect(r.kind).toBe('raw');
  expect(r.long).toBe(2048);
  expect(r.m).toBe(9);
});

test('retain: false で開くとフル解像度の元データを Worker に残さない（最終レビュー I4a）', async ({ page }) => {
  await h.open(page);
  const err = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const f = await file('fixtures/gray128.jpg');
    const { handle, working } = await decoder.open(f, f.name, { workCap: 4096, retain: false });
    if (working.width !== 64) return 'bad working';
    try { await decoder.readTile(handle, { x: 0, y: 0, w: 1, h: 1 }); return null; } catch (e) { return String(e); }
  });
  expect(err).not.toBeNull();
});

test('連続した open は順番に処理され、最後に開いた画像が残る（最終レビュー I4b）', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { decoder, file } = (window as unknown as W).__dec;
    const big = await file('fixtures/pano9000.jpg'), small = await file('fixtures/gray128.jpg');
    const [a, b] = await Promise.all([decoder.open(big, big.name, { workCap: 4096 }), decoder.open(small, small.name, { workCap: 4096 })]);
    const bOk = await decoder.readTile(b.handle, { x: 0, y: 0, w: 1, h: 1 }).then(() => true, () => false);
    const aOk = await decoder.readTile(a.handle, { x: 0, y: 0, w: 1, h: 1 }).then(() => true, () => false);
    return { aOk, bOk };
  });
  expect(r).toEqual({ aOk: false, bOk: true });
});
