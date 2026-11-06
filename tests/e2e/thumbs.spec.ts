// サムネイルキャッシュ（計画 Task 18）を実 IndexedDB・実 Decoder で検証する。
import { test, expect } from '@playwright/test';
import { useHarness } from './helpers/harness';
import type { ThumbsHarness } from './harness/thumbs-harness';

const h = useHarness('tests/e2e/harness/thumbs-harness.ts', 'thumbs-harness-ready');
type W = { __th: ThumbsHarness };
test.describe.configure({ timeout: 60_000 });

test('同じ ref の 2 回目の get で decoder.preview が呼ばれない（再読み込み後も IndexedDB から）', async ({ page }) => {
  await h.open(page);
  const first = await page.evaluate(async () => {
    const { make, ref, stats, size } = (window as unknown as W).__th;
    const c = make('t1');
    const a = await c.get(ref('fixtures/pano9000.jpg'));
    await c.get(ref('fixtures/pano9000.jpg'));
    return { calls: stats.calls, ...(await size(a)) };
  });
  expect(first.calls).toBe(1);
  expect(Math.max(first.w, first.h)).toBeLessThanOrEqual(320);
  await h.open(page);
  const calls = await page.evaluate(async () => {
    const { make, ref, stats } = (window as unknown as W).__th;
    await make('t1').get(ref('fixtures/pano9000.jpg'));
    return stats.calls;
  });
  expect(calls).toBe(0);
});

test('mtime が変わると再生成', async ({ page }) => {
  await h.open(page);
  const calls = await page.evaluate(async () => {
    const { make, ref, stats } = (window as unknown as W).__th;
    const c = make('t2');
    await c.get(ref('fixtures/gray128.jpg', 1));
    await c.get(ref('fixtures/gray128.jpg', 2));
    return stats.calls;
  });
  expect(calls).toBe(2);
});

test('同時に 10 件要求しても preview の同時実行が 2 以下', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { make, ref, stats } = (window as unknown as W).__th;
    const c = make('t3');
    const blobs = await Promise.all(Array.from({ length: 10 }, (_, i) => c.get(ref(`fixtures/gray128.jpg#${i}`))));
    return { n: blobs.filter((b) => b.size > 0).length, calls: stats.calls, max: stats.maxActive };
  });
  expect(r.n).toBe(10);
  expect(r.calls).toBe(10);
  expect(r.max).toBeLessThanOrEqual(2);
});
