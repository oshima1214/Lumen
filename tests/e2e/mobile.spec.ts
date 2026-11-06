// iPhone 画面（計画 Task 27）: 一覧 → 編集、タブ、押しやすさ、長押しで編集前、スワイプ、共有、取り込みの案内。
import { test, expect, type Page } from '@playwright/test';
import { useAppHarness } from './helpers/app-harness';

const app = useAppHarness('mobile');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
test.describe.configure({ timeout: 120_000 });

interface Lumen { editor: { working: unknown; currentId: string | null; view: { before: boolean }; images: { id: string }[] } }
const ed = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor;
  return { id: e.currentId, before: e.view.before, ready: e.working !== null, ids: e.images.map((i) => i.id) };
});

async function openEditor(page: Page): Promise<void> {
  await app.open(page, { backend: 'library' });
  const items = page.getByTestId('grid-item');
  await expect(items).toHaveCount(3);
  await items.first().click();
  await expect(page.getByTestId('mobile-editor')).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.working !== null);
}

test('一覧 → タップで編集画面、ライトのタブに露光量、ボタンは 44px 以上', async ({ page }) => {
  await openEditor(page);
  await page.getByTestId('tool-tabs').getByRole('button', { name: 'ライト' }).click();
  await expect(page.getByRole('slider', { name: '露光量' })).toBeVisible();
  const boxes = await page.locator('[data-testid="mobile-editor"] header button, [data-testid="tool-tabs"] button').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, (e as HTMLElement).innerText || e.getAttribute('aria-label')]; }));
  expect(boxes.length).toBeGreaterThan(5);
  for (const [w, h, name] of boxes) { expect(w as number, String(name)).toBeGreaterThanOrEqual(44); expect(h as number, String(name)).toBeGreaterThanOrEqual(44); }
});

test('写真を長押しすると編集前を表示し、離すと戻る', async ({ page }) => {
  await openEditor(page);
  const photo = page.getByTestId('mobile-photo');
  const box = (await photo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  expect((await ed(page)).before).toBe(true);
  await page.mouse.up();
  expect((await ed(page)).before).toBe(false);
});

test('左にスワイプすると次の写真', async ({ page }) => {
  await openEditor(page);
  const first = (await ed(page)).id;
  const photo = page.getByTestId('mobile-photo');
  const box = (await photo.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  // 素早いスワイプ（判定は 500ms 以内。SwiftShader 環境は遅いので移動は 1 回にまとめる）
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.up();
  await page.waitForFunction((f) => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.currentId !== f, first);
});

test('共有ボタンで現在の写真を JPEG にして共有シートへ渡す', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '共有' }).click();
  await page.waitForFunction(() => (window as unknown as { __shared: File[] }).__shared.length === 1, undefined, { timeout: 60_000 });
  const f = await page.evaluate(() => { const x = (window as unknown as { __shared: File[] }).__shared[0]!; return { type: x.type, name: x.name, size: x.size }; });
  expect(f.type).toBe('image/jpeg');
  expect(f.size).toBeGreaterThan(100);
});

test('取り込みで HEIC 名の JPEG を渡すと「ファイル」から選ぶ案内が出る', async ({ page }) => {
  await app.open(page, { backend: 'library' });
  await expect(page.getByTestId('grid-item')).toHaveCount(3);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '写真を取り込む' }).click();
  const jpeg = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch('/__e2e/files/fixtures/gray128.jpg')).arrayBuffer())));
  await (await chooser).setFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) });
  await expect(page.getByText(/「ファイル」から選ぶ/)).toBeVisible();
  await expect(page.getByTestId('grid-item')).toHaveCount(4);
});
