// プリセット・設定のコピー＆ペースト・書き出しダイアログ（計画 Task 26、仕様 4.3 / 4.4 / 6）。
// テストモードのアプリ（Task 22）に偽のフォルダを注入し、フォルダ選択は __lumenTestPickDirectory が偽のフォルダを返す。
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { useAppHarness } from './helpers/app-harness';

const app = useAppHarness('dialogs');
test.use({ viewport: { width: 1280, height: 900 } });

interface Params { basic: { exposure: number; contrast: number }; wb: unknown; crop: unknown }
interface Lumen {
  editor: {
    images: { id: string; name: string }[]; currentId: string | null; selection: string[]; working: unknown;
    update(f: (p: Params) => void): void;
  };
  renderer: { snapshot(): Promise<{ w: number; h: number; data: Uint8Array }> };
  backend: {
    readSidecar(id: string): Promise<{ params: Partial<Params> } | null>;
    presets: { list(): Promise<{ name: string; params: unknown }[]> };
    saveExport(name: string, blob: Blob): Promise<string>;
  };
}
type W = { __lumenApp: Lumen; __lumenTestDirs: Record<string, { children: Map<string, unknown> }>; __release?: () => void };

const film = (page: Page) => page.getByTestId('filmstrip').locator('[data-id]');

async function ready(page: Page, set: 'basic' | 'broken' = 'basic'): Promise<void> {
  await app.open(page, { set });
  await page.waitForFunction(() => (window as unknown as W).__lumenApp.editor.working !== null);
}

/** 現在の画像に切り替わって描画が終わるまで待つ */
async function openNth(page: Page, n: number): Promise<string> {
  await film(page).nth(n).click();
  const id = await film(page).nth(n).getAttribute('data-id');
  await page.waitForFunction((id) => {
    const e = (window as unknown as W).__lumenApp.editor;
    return e.currentId === id && e.working !== null;
  }, id);
  return id!;
}

/** 描画が落ち着いた中央画素の RGB */
async function centre(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const s = await (window as unknown as W).__lumenApp.renderer.snapshot();
    if (s.w === 0) return [];
    const i = (Math.floor(s.h / 2) * s.w + Math.floor(s.w / 2)) * 4;
    return [s.data[i]!, s.data[i + 1]!, s.data[i + 2]!];
  });
}

test('「設定をコピー」の初期チェック: WB と切り抜きはオフ、他はオン', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('Control+Shift+C');
  const dlg = page.getByRole('dialog', { name: '設定をコピー' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('checkbox', { name: 'ホワイトバランス' })).not.toBeChecked();
  await expect(dlg.getByRole('checkbox', { name: '切り抜き' })).not.toBeChecked();
  for (const n of ['基本補正', 'トーンカーブ', 'HSL', 'カラーグレーディング']) {
    await expect(dlg.getByRole('checkbox', { name: n })).toBeChecked();
  }
  // ダイアログ表示中は画像送りのショートカットが効かない
  const before = await page.evaluate(() => (window as unknown as W).__lumenApp.editor.currentId);
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => (window as unknown as W).__lumenApp.editor.currentId)).toBe(before);
  await dlg.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dlg).toBeHidden();
});

test('2 枚を選択してペースト → 2 枚のサイドカーが更新される（WB は貼らない）', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as unknown as W).__lumenApp.editor.update((p) => {
    p.basic.exposure = 1.25;
    (p.wb as { mode: string; temp: number; tint: number }) = { mode: 'custom', temp: 30, tint: 0 };
  }));
  await page.keyboard.press('Control+Shift+C');
  await page.getByRole('dialog', { name: '設定をコピー' }).getByRole('button', { name: 'コピー' }).click();
  await openNth(page, 1);
  await film(page).nth(2).click({ modifiers: ['Control'] });
  const ids = await page.evaluate(() => (window as unknown as W).__lumenApp.editor.selection);
  expect(ids).toHaveLength(2);
  await page.keyboard.press('Control+Shift+V');
  for (const id of ids) {
    await expect.poll(() => page.evaluate(async (id) => {
      const s = await (window as unknown as W).__lumenApp.backend.readSidecar(id);
      return s?.params.basic?.exposure ?? null;
    }, id)).toBe(1.25);
    expect(await page.evaluate(async (id) => (await (window as unknown as W).__lumenApp.backend.readSidecar(id))?.params.wb ?? null, id)).toBeNull();
  }
});

test('組み込み「モノクロ」を適用 → 中央画素が R=G=B', async ({ page }) => {
  await ready(page);
  await openNth(page, 2); // カラーチャート（中央はアクア）
  await expect.poll(async () => { const [r, , b] = await centre(page); return Math.abs((r ?? 0) - (b ?? 0)); }).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'モノクロ', exact: true }).click();
  // 8bit 出力のディザはチャンネルごとに独立（Task 13）なので ±1 を許す
  await expect.poll(async () => {
    const [r, g, b] = await centre(page);
    return Math.max(Math.abs(r! - g!), Math.abs(g! - b!), Math.abs(r! - b!));
  }).toBeLessThanOrEqual(1);
  // 組み込みは削除できない
  await expect(page.getByRole('button', { name: 'モノクロ を削除' })).toHaveCount(0);
});

test('プリセット作成 → 一覧に出る → JSON 書き出し → 削除 → 読み込みで同じ内容', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as unknown as W).__lumenApp.editor.update((p) => { p.basic.exposure = 0.7; p.basic.contrast = 25; }));
  const presets = page.getByRole('region', { name: 'プリセット' });
  await presets.getByRole('button', { name: 'プリセットフォルダを選ぶ' }).click();
  await expect(presets.getByText('保存先: プリセット')).toBeVisible();
  await presets.getByRole('button', { name: '現在の設定から作成' }).click();
  const dlg = page.getByRole('dialog', { name: 'プリセットを作成' });
  await dlg.getByRole('textbox', { name: 'プリセット名' }).fill('テスト用');
  await expect(dlg.getByRole('checkbox', { name: 'ホワイトバランス' })).not.toBeChecked();
  await dlg.getByRole('button', { name: '保存' }).click();
  await expect(presets.getByRole('button', { name: 'テスト用', exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    presets.getByRole('button', { name: 'テスト用 を書き出し' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('テスト用.json');
  const text = await readFile((await download.path())!, 'utf8');
  const json = JSON.parse(text) as { app: string; name: string; params: Partial<Params> };
  expect(json.app).toBe('lumen');
  expect(json.name).toBe('テスト用');
  expect(json.params.basic?.exposure).toBe(0.7);
  expect(json.params.basic?.contrast).toBe(25);
  expect(json.params.wb).toBeUndefined();
  expect(json.params.crop).toBeUndefined();

  await presets.getByRole('button', { name: 'テスト用 を削除' }).click();
  await presets.getByRole('button', { name: '削除する' }).click();
  await expect(presets.getByRole('button', { name: 'テスト用', exact: true })).toHaveCount(0);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    presets.getByRole('button', { name: '読み込み' }).click(),
  ]);
  await chooser.setFiles({ name: 'テスト用.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(presets.getByRole('button', { name: 'テスト用', exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => (await (window as unknown as W).__lumenApp.backend.presets.list()).find((p) => p.name === 'テスト用'));
  expect(stored?.params).toEqual(json.params);
});

/** 3 枚すべてを選択して書き出しダイアログを開き、書き出し先を選ぶ */
async function openExport(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await film(page).nth(0).click();
  await film(page).nth(2).click({ modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__lumenApp.editor.selection.length)).toBe(3);
  await page.keyboard.press('Control+Shift+E');
  const dlg = page.getByRole('dialog', { name: '書き出し' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('3 枚')).toBeVisible();
  await dlg.getByRole('button', { name: '書き出し先を選ぶ' }).click();
  await expect(dlg.getByText('書き出し先: 書き出し')).toBeVisible();
  return dlg;
}

test('書き出し: 進捗が表示され、キャンセルで止まる', async ({ page }) => {
  await ready(page, 'broken');
  const dlg = await openExport(page);
  // 1 枚目の保存で止めておき、その間にキャンセルする
  await page.evaluate(() => {
    const w = window as unknown as W;
    const b = w.__lumenApp.backend;
    const orig = b.saveExport.bind(b);
    b.saveExport = async (n, blob) => { await new Promise<void>((r) => { w.__release = r; }); return orig(n, blob); };
  });
  await dlg.getByRole('button', { name: '書き出す' }).click();
  const bar = dlg.getByRole('progressbar', { name: '書き出しの進捗' });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuemax', '3');
  await expect(dlg.getByText('0 / 3')).toBeVisible();
  await page.waitForFunction(() => typeof (window as unknown as W).__release === 'function');
  await dlg.getByRole('button', { name: 'キャンセル' }).click();
  await page.evaluate(() => (window as unknown as W).__release!());
  await expect(dlg.getByText('キャンセルしました')).toBeVisible();
  await expect(dlg.getByText('1 枚を保存しました')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as W).__lumenTestDirs['export']!.children.size)).toBe(1);
});

test('書き出し: 終了時に失敗一覧が出る、設定は次回も残る', async ({ page }) => {
  await ready(page, 'broken');
  const dlg = await openExport(page);
  await dlg.getByRole('radio', { name: 'PNG' }).check();
  await dlg.getByRole('button', { name: '書き出す' }).click();
  await expect(dlg.getByText('2 枚を保存しました')).toBeVisible({ timeout: 30_000 });
  const failed = dlg.getByRole('list', { name: '書き出せなかった写真' });
  await expect(failed.getByRole('listitem')).toHaveCount(1);
  await expect(failed).toContainText('02 壊れた.jpg');
  const names = await page.evaluate(() => [...(window as unknown as W).__lumenTestDirs['export']!.children.keys()].sort());
  expect(names).toEqual(['01 グレー.png', '03 カラーチャート.png']);
  await dlg.getByRole('button', { name: '閉じる' }).click();
  await expect(dlg).toBeHidden();
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('dialog', { name: '書き出し' }).getByRole('radio', { name: 'PNG' })).toBeChecked();
});
