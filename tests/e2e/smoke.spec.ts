import { test, expect } from '@playwright/test';

test('page loads and WebGPU adapter exists', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Lumen');
  expect(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))).toBe(true);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});
