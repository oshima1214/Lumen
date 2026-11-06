// トーンカーブ編集と切り抜きツール（計画 Task 25）。
import { test, expect, type Page } from '@playwright/test';
import { useAppHarness } from './helpers/app-harness';

const app = useAppHarness('crop');
test.use({ viewport: { width: 1280, height: 900 } });

type Crop = { x: number; y: number; w: number; h: number; angle: number; aspect: string };
interface Lumen {
  app: { tool: string; cropDraft: Crop | null };
  editor: { working: { fullWidth: number; fullHeight: number; orientation: number } | null; currentId: string | null;
    previewCrop: Crop | null; params: { crop: Crop; curve: { rgb: [number, number][]; r: [number, number][] } } };
}
const L = (page: Page) => page.evaluate(() => {
  const a = (window as unknown as { __lumenApp: Lumen }).__lumenApp;
  return { tool: a.app.tool, working: a.editor.working && { w: a.editor.working.fullWidth, h: a.editor.working.fullHeight },
    preview: a.app.cropDraft, render: a.editor.previewCrop, crop: a.editor.params.crop, curve: a.editor.params.curve, id: a.editor.currentId };
});
async function ready(page: Page, index = 0): Promise<void> {
  await app.open(page);
  await page.waitForFunction(() => (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor.working !== null);
  for (let i = 0; i < index; i++) {
    const before = (await L(page)).id;
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((b) => {
      const e = (window as unknown as { __lumenApp: Lumen }).__lumenApp.editor;
      return e.currentId !== b && e.working !== null;
    }, before);
  }
}
function insideRotated(x: number, y: number, W: number, H: number, deg: number): boolean {
  const t = (deg * Math.PI) / 180, dx = x - W / 2, dy = y - H / 2;
  const rx = Math.cos(t) * dx + Math.sin(t) * dy, ry = -Math.sin(t) * dx + Math.cos(t) * dy;
  return Math.abs(rx) <= W / 2 + 1e-6 && Math.abs(ry) <= H / 2 + 1e-6;
}

test('R キーで切り抜きモード、1:1 を選ぶと枠がピクセルで正方形、Enter で確定', async ({ page }) => {
  await ready(page, 1);                       // 256x16 のグラデーション
  await page.keyboard.press('r');
  await expect(page.getByTestId('crop-overlay')).toBeVisible();
  expect((await L(page)).tool).toBe('crop');
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const s = await L(page);
  expect(s.preview!.w * s.working!.w).toBeCloseTo(s.preview!.h * s.working!.h, 3);
  expect(s.crop.w).toBe(1);                   // 確定前は params を変えない
  expect(s.render).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });   // プレビューは画像全体を描く
  await page.keyboard.press('Enter');
  const t = await L(page);
  expect(t.tool).toBe('develop');
  expect(t.preview).toBeNull();
  expect(t.crop.aspect).toBe('1:1');
  expect(t.crop.w * t.working!.w).toBeCloseTo(t.crop.h * t.working!.h, 3);
});

test('角度 10° で枠が画像内に収まり、Esc で取り消せる', async ({ page }) => {
  await ready(page, 1);
  await page.keyboard.press('r');
  await page.getByRole('spinbutton', { name: '角度' }).fill('10');
  await page.keyboard.press('Tab');
  const s = await L(page);
  const c = s.preview!;
  expect(c.angle).toBeCloseTo(10, 0);
  for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]] as const) {
    expect(insideRotated(x * s.working!.w, y * s.working!.h, s.working!.w, s.working!.h, c.angle)).toBe(true);
  }
  await page.keyboard.press('Escape');
  const t = await L(page);
  expect(t.tool).toBe('develop');
  expect(t.crop.angle).toBe(0);
});

test('枠の右下の取っ手をドラッグすると枠が縮む', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('r');
  const h = page.getByTestId('crop-handle-se');
  const box = (await h.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y - 60, { steps: 5 });
  await page.mouse.up();
  const s = await L(page);
  expect(s.preview!.w).toBeLessThan(1);
  expect(s.preview!.h).toBeLessThan(1);
});

test('トーンカーブ: クリックで点を追加、ダブルクリックで削除、R チャンネルに切り替え', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'トーンカーブ' }).click();
  const svg = page.getByTestId('curve-svg');
  await svg.scrollIntoViewIfNeeded();
  let box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);   // (0.5, 0.7) あたり
  let s = await L(page);
  expect(s.curve.rgb.length).toBe(3);
  expect(s.curve.rgb[1]![1]).toBeGreaterThan(0.6);
  await page.getByTestId('curve-point-1').dblclick();
  s = await L(page);
  expect(s.curve.rgb.length).toBe(2);
  await page.getByRole('tab', { name: 'R', exact: true }).click();
  await svg.scrollIntoViewIfNeeded();
  box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  s = await L(page);
  expect(s.curve.r.length).toBe(3);
  expect(s.curve.rgb.length).toBe(2);
});
