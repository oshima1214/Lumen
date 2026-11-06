// アプリの土台（計画 Task 22）: 非対応画面、レイアウト切り替え、配色、テスト用 backend の注入。
import { test, expect } from '@playwright/test';
import { useAppHarness } from './helpers/app-harness';

test('WebGPU が無いと理由を表示して止まる', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { gpu?: unknown }).gpu;
  });
  await page.goto('/');
  await expect(page.getByTestId('unsupported')).toContainText('WebGPU');
  await expect(page.getByTestId('right-panel')).toHaveCount(0);
});

test('1280×800 では右パネルが見える', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('right-panel')).toBeVisible();
  await expect(page.getByTestId('tool-tabs')).toHaveCount(0);
});

test('390×844 では下部のツールタブが見える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('tool-tabs')).toBeVisible();
  await expect(page.getByTestId('right-panel')).toHaveCount(0);
});

test('幅を変えるとレイアウトが切り替わる（1024px 境界）', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('right-panel')).toBeVisible();
  await page.setViewportSize({ width: 1023, height: 800 });
  await expect(page.getByTestId('tool-tabs')).toBeVisible();
  await expect(page.getByTestId('right-panel')).toHaveCount(0);
});

test('body の背景は --bg（#1C1C1C）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('right-panel')).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(28, 28, 28)');
});

test('本番ビルドは window.__lumenTestBackend を無視する', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __lumenTestBackend: unknown }).__lumenTestBackend = {
      kind: 'folder',
      list: async () => [{ id: 'x/inject.jpg', name: 'inject.jpg', size: 1, mtime: 1, group: '' }],
      needsPermission: async () => false,
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByTestId('right-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'フォルダを開く' }).first()).toBeVisible();
  await expect(page.getByText('inject.jpg')).toHaveCount(0);
});

test.describe('テストモードのビルド', () => {
  const app = useAppHarness('shell');
  test('window.__lumenTestBackend の画像が一覧に出る', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.open(page);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __lumenApp?: { editor: { images: unknown[] } } }).__lumenApp?.editor.images.length ?? 0)).toBe(3);
    await expect(page.getByTestId('right-panel')).toBeVisible();
  });
});
