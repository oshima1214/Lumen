// Task 13 Step 5: iPhone 実機検証ページ（dist/gpu-check/index.html）が PC の Chromium でも最後まで動くこと
import { test, expect } from '@playwright/test';

test('/gpu-check/ が全項目を計測して完了する', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/gpu-check/?size=256');
  await expect(page).toHaveTitle('gpu-check-done', { timeout: 100_000 });
  const report = JSON.parse((await page.locator('#json').textContent()) ?? '{}') as Record<string, unknown>;
  expect(errors).toEqual([]);
  expect(report.rgba16floatStorage).toBe('書き込み・読み戻し OK');
  expect(typeof report.maxTextureDimension2D).toBe('string');
  expect(report.alloc4096x3072).toMatch(/確保 OK/);
  expect(report).toHaveProperty('alloc8064x6048');
  expect(report.developMs).toMatch(/^[\d.]+ ms/);
  expect(report.baseLayerMs).toMatch(/^[\d.]+ ms/);
  await expect(page.locator('#results tr')).toHaveCount(9);
});
