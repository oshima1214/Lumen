// PC 画面（計画 Task 23）: フィルムストリップ・画像送り・ビューア・編集前後・エラーのサムネイル・権限の再許可。
// テストモードのアプリに偽のフォルダ（fake-fs）を window.__lumenTestBackend で注入する（Task 22）。
import { test, expect, type Page } from '@playwright/test';
import { useAppHarness } from './helpers/app-harness';

const app = useAppHarness('desktop');
test.use({ viewport: { width: 1280, height: 800 } });

interface Lumen {
  editor: {
    images: { id: string }[]; currentId: string | null; working: unknown; params: { basic: { exposure: number } };
    view: { mode: string; before: boolean; background: string; cx: number; cy: number };
    update(f: (p: { basic: { exposure: number } }) => void): void;
  };
  renderer: { snapshot(): Promise<{ w: number; h: number; data: Uint8Array }> };
}

const film = (page: Page) => page.getByTestId('filmstrip').locator('[data-id]');

/** 描画が終わるまで待って中央画素の RGB を返す */
async function centre(page: Page): Promise<number[]> {
  await page.waitForFunction(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.working !== null);
  let px: number[] = [];
  await expect.poll(async () => {
    px = await page.evaluate(async () => {
      const s = await (window as unknown as { __lumenApp: Lumen }).__lumenApp.renderer.snapshot();
      if (s.w === 0) return [];
      const i = (Math.floor(s.h / 2) * s.w + Math.floor(s.w / 2)) * 4;
      return [s.data[i]!, s.data[i + 1]!, s.data[i + 2]!];
    });
    return px.length;
  }).toBe(3);
  return px;
}

test('3 枚のフィルムストリップ、→ で 2 枚目が選択される', async ({ page }) => {
  await app.open(page);
  await expect(film(page)).toHaveCount(3);
  await expect(film(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(film(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(film(page).nth(0)).toHaveAttribute('aria-selected', 'false');
  const ids = await page.evaluate(() => {
    const e = (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor;
    return { cur: e.currentId, second: e.images[1]!.id };
  });
  expect(ids.cur).toBe(ids.second);
  await page.keyboard.press('ArrowLeft');
  await expect(film(page).nth(0)).toHaveAttribute('aria-selected', 'true');
});

test('サムネイルが表示される', async ({ page }) => {
  await app.open(page);
  await expect(film(page).nth(0).locator('img')).toHaveJSProperty('complete', true);
  await expect.poll(() => film(page).nth(0).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
});

test('ビューアに canvas が描画され、中央画素が黒でない', async ({ page }) => {
  await app.open(page);
  await expect(page.getByTestId('viewer').locator('canvas')).toBeVisible();
  const px = await centre(page);
  expect(Math.max(...px)).toBeGreaterThan(20);
});

test('\\ を押している間だけ編集前を表示する', async ({ page }) => {
  await app.open(page);
  await centre(page);
  await page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.update((p) => { p.basic.exposure = 2; }));
  await expect.poll(async () => (await centre(page))[0]).toBeGreaterThan(200);
  const edited = await centre(page);
  await page.keyboard.down('\\');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.view.before)).toBe(true);
  await expect.poll(async () => (await centre(page))[0]).toBeLessThan(edited[0]! - 40);
  await page.keyboard.up('\\');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.view.before)).toBe(false);
  await expect.poll(async () => (await centre(page))[0]).toBe(edited[0]);
});

test('画面に合わせる／100% の切り替え、100% ではドラッグで移動', async ({ page }) => {
  await app.open(page);
  await centre(page);
  const view = () => page.evaluate(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.view);
  await page.getByRole('button', { name: '100%' }).click();
  await expect.poll(async () => (await view()).mode).toBe('100');
  const before = await view();
  const box = (await page.getByTestId('viewer').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  const after = await view();
  expect(after.cx).toBeGreaterThan(before.cx);
  expect(after.cy).toBeGreaterThan(before.cy);
  await page.getByRole('button', { name: '画面に合わせる' }).click();
  await expect.poll(async () => (await view()).mode).toBe('fit');
});

test('写真の周囲の背景を 3 種から選べる', async ({ page }) => {
  await app.open(page);
  const viewer = page.getByTestId('viewer');
  await page.getByRole('radio', { name: '18% グレー' }).click();
  await expect(viewer).toHaveCSS('background-color', 'rgb(119, 119, 119)');
  await page.getByRole('radio', { name: '黒' }).click();
  await expect(viewer).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await page.getByRole('radio', { name: 'ダークグレー' }).click();
  await expect(viewer).toHaveCSS('background-color', 'rgb(28, 28, 28)');
});

test('数字キーでレーティング', async ({ page }) => {
  await app.open(page);
  await expect(film(page)).toHaveCount(3);
  await page.keyboard.press('3');
  await expect(film(page).nth(0)).toHaveAttribute('data-rating', '3');
  await page.keyboard.press('0');
  await expect(film(page).nth(0)).toHaveAttribute('data-rating', '0');
});

test('壊れた画像はエラーのサムネイルになり、他の画像は表示される', async ({ page }) => {
  await app.open(page, { set: 'broken' });
  await expect(film(page)).toHaveCount(3);
  const broken = page.getByTestId('filmstrip').locator('[data-id$="02 壊れた.jpg"]');
  await expect(broken).toHaveAttribute('data-error', /.+/);
  await expect(film(page).nth(2).locator('img')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('viewer')).toContainText('開けません');
  await page.keyboard.press('ArrowRight');
  const px = await centre(page);
  expect(Math.max(...px)).toBeGreaterThan(20);
});

test('フォルダの権限が失効していたら「アクセスを再許可」を出す', async ({ page }) => {
  await app.open(page, { perm: 'prompt' });
  const btn = page.getByRole('button', { name: 'アクセスを再許可' });
  await expect(btn).toBeVisible();
  await expect(film(page)).toHaveCount(0);
  await btn.click();
  await expect(btn).toHaveCount(0);
  await expect(film(page)).toHaveCount(3);
});

test('操作してもコンソールにエラーが出ない', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await app.open(page);
  await centre(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await centre(page);
  await page.getByRole('button', { name: '100%' }).click();
  await page.keyboard.press('Control+z');
  await page.setViewportSize({ width: 1100, height: 700 });
  await centre(page);
  expect(errors).toEqual([]);
});
