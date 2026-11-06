// 調整パネル（計画 Task 24）: スライダーのジェスチャーと Undo、既定値、直接入力、トラックの色、HSL、ヒストグラム。
import { test, expect, type Page } from '@playwright/test';
import { useAppHarness } from './helpers/app-harness';

const app = useAppHarness('panels');
test.use({ viewport: { width: 1280, height: 900 } });

interface Lumen {
  editor: { working: unknown; canUndo: boolean; params: { basic: { exposure: number } } };
}
const exposure = (page: Page) => page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.params.basic.exposure);

async function ready(page: Page): Promise<void> {
  await app.open(page);
  await page.waitForFunction(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.working !== null);
}

test('露光量スライダーをドラッグ → 1 回の取り消しで元に戻る', async ({ page }) => {
  await ready(page);
  const s = page.getByRole('slider', { name: '露光量' });
  const box = (await s.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2);
  await page.mouse.up();
  expect(await exposure(page)).toBeGreaterThan(0.5);
  await page.keyboard.press('Control+z');
  expect(await exposure(page)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.canUndo)).toBe(false);
});

test('ダブルクリックで既定値（0）に戻る', async ({ page }) => {
  await ready(page);
  const s = page.getByRole('slider', { name: '露光量' });
  await s.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await exposure(page)).toBeGreaterThan(0);
  await s.dblclick();
  expect(await exposure(page)).toBe(0);
});

test('数値をタップして直接入力（1.5 はそのまま、9 は 5 に丸める）', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '露光量の値' }).click();
  const input = page.getByRole('textbox', { name: '露光量を入力' });
  await input.fill('1.5');
  await input.press('Enter');
  expect(await exposure(page)).toBe(1.5);
  await expect(page.getByRole('button', { name: '露光量の値' })).toHaveText('+1.50');
  await page.getByRole('button', { name: '露光量の値' }).click();
  await page.getByRole('textbox', { name: '露光量を入力' }).fill('9');
  await page.getByRole('textbox', { name: '露光量を入力' }).press('Enter');
  expect(await exposure(page)).toBe(5);
});

test('数値は等幅数字', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('button', { name: '露光量の値' })).toHaveCSS('font-variant-numeric', 'tabular-nums');
});

test('色温度・色かぶりのトラックはグラデーション', async ({ page }) => {
  await ready(page);
  for (const name of ['色温度', '色かぶり']) {
    const bg = await page.getByRole('slider', { name }).evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('linear-gradient');
  }
  // JPEG / PNG は ±100 の相対値
  await expect(page.getByRole('slider', { name: '色温度' })).toHaveAttribute('aria-valuemin', '-100');
});

test('HSL の 8 色が並ぶ', async ({ page }) => {
  await ready(page);
  const panel = page.getByTestId('hsl-panel');
  const names = ['レッド', 'オレンジ', 'イエロー', 'グリーン', 'アクア', 'ブルー', 'パープル', 'マゼンタ'];
  await expect(panel.getByRole('slider')).toHaveCount(8);
  for (const n of names) await expect(panel.getByRole('slider', { name: n })).toBeVisible();
  await panel.getByRole('radio', { name: '彩度' }).click();
  await panel.getByRole('slider', { name: 'ブルー' }).dblclick();
  await expect(panel.getByRole('slider')).toHaveCount(8);
});

test('ヒストグラムの canvas が描画される', async ({ page }) => {
  await ready(page);
  const canvas = page.getByTestId('histogram').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  })).toBeGreaterThan(50);
});

test('カラーグレーディングのスライダーが params に反映される', async ({ page }) => {
  await ready(page);
  const panel = page.getByTestId('grading-panel');
  await panel.getByRole('button', { name: 'ブレンドの値' }).click();
  await panel.getByRole('textbox', { name: 'ブレンドを入力' }).fill('70');
  await panel.getByRole('textbox', { name: 'ブレンドを入力' }).press('Enter');
  expect(await page.evaluate(() => (window as unknown as { __lumenApp: { editor: { params: { grading: { blending: number } } } } }).__lumenApp.editor.params.grading.blending)).toBe(70);
});
