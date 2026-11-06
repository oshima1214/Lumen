import { test, expect } from '@playwright/test';

test('manifest と apple-touch-icon がある', async ({ page }) => {
  await page.goto('/');
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBeTruthy();
  const res = await page.request.get(new URL(manifest!, page.url()).toString());
  const m = await res.json();
  expect(m.name).toBe('Lumen');
  expect(m.display).toBe('standalone');
  expect(m.background_color.toLowerCase()).toBe('#1c1c1c');
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(await page.locator('link[rel="apple-touch-icon"]').count()).toBe(1);
});

test('オフラインにしてリロードしてもアプリが起動する', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();                          // SW の制御下で一度読み込む
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('Lumen');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await context.setOffline(false);
});
