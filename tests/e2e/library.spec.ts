// LibraryBackend を実 OPFS（Chromium）で検証する。
// テスト用コードは本番バンドルに入れない: ここで vite の build() を使って
// tests/e2e/harness/storage-harness.ts をメモリ上でバンドルし、page.route で
// アプリと同じオリジンの /__e2e/ 以下として配信する（OPFS はオリジン単位のため）。
import { test, expect, type Page } from '@playwright/test';
import { build, type Rollup } from 'vite';
import type { StorageHarness } from './harness/storage-harness';

const files = new Map<string, { body: string | Uint8Array; type: string }>();

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    root: process.cwd(),
    base: '/__e2e/',
    publicDir: false,
    logLevel: 'warn',
    build: {
      write: false,
      minify: false,
      modulePreload: false,
      rollupOptions: {
        input: { harness: 'tests/e2e/harness/storage-harness.ts' },
        output: { entryFileNames: '[name].js' },
      },
    },
    worker: { format: 'es' },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  for (const out of outputs) {
    for (const item of out.output) {
      const body = item.type === 'chunk' ? item.code : item.source;
      files.set(item.fileName, { body, type: item.fileName.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    }
  }
  expect(files.has('harness.js')).toBe(true);
});

async function openHarness(page: Page): Promise<void> {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  await page.route('**/__e2e/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/__e2e\//, '');
    if (path === '' || path === 'index.html') {
      return route.fulfill({
        headers, contentType: 'text/html',
        body: '<!doctype html><meta charset="utf-8"><title>loading</title><script type="module" src="/__e2e/harness.js"></script>',
      });
    }
    const f = files.get(path);
    if (!f) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ headers, contentType: f.type, body: typeof f.body === 'string' ? f.body : Buffer.from(f.body) });
  });
  await page.goto('/__e2e/index.html');
  await expect(page).toHaveTitle('storage-harness-ready');
}

for (const sync of [false, true]) {
  test(`共通契約（実 OPFS、${sync ? 'createSyncAccessHandle（Worker）' : 'createWritable'}）`, async ({ page }) => {
    await openHarness(page);
    const { results, files: opfsFiles } = await page.evaluate(
      (s) => (window as unknown as { __storage: StorageHarness }).__storage.runLibraryContract(s),
      sync,
    );
    expect(results.length).toBeGreaterThanOrEqual(7);
    for (const r of results) expect(r.error, r.name).toBeNull();
    // 一時ファイル（Worker 経路の <name>.tmp）が残らない
    expect(opfsFiles.filter((p) => p.endsWith('.tmp'))).toEqual([]);
    expect(opfsFiles.some((p) => p.endsWith('/sidecar.json.bak'))).toBe(true);
  });
}

test('importFiles で 2 枚取り込むと list() は 2 件で group は今日', async ({ page }) => {
  await openHarness(page);
  const r = await page.evaluate(async () => {
    const h = (window as unknown as { __storage: StorageHarness }).__storage;
    const root = await h.freshRoot();
    const lib = h.makeLibrary(root);
    const res = await lib.importFiles([
      new File(['one'], 'IMG_0001.JPG', { type: 'image/jpeg' }),
      new File(['two'], 'IMG_0002.HEIC', { type: 'image/jpeg' }),
    ]);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const list = await lib.list();
    const tree = await h.snapshot(root);
    const orig = await lib.readOriginal(list[0]!.id);
    return { list, today, transcoded: res.transcoded, tree, origText: await orig.text(), origName: orig.name };
  });
  expect(r.list.length).toBe(2);
  expect(r.list.map((x) => x.group)).toEqual([r.today, r.today]);
  expect(r.list.map((x) => x.name).sort()).toEqual(['IMG_0001.JPG', 'IMG_0002.HEIC']);
  expect(r.transcoded).toEqual(['IMG_0002.HEIC']);
  expect([r.origName, r.origText]).toEqual([r.list[0]!.name, r.list[0]!.name === 'IMG_0001.JPG' ? 'one' : 'two']);
  for (const ref of r.list) {
    expect(r.tree).toContain(`library/${ref.id}/meta.json`);
    expect(r.tree.some((p) => p.startsWith(`library/${ref.id}/original.`))).toBe(true);
  }
});

test('空き 1 バイトなら QuotaError で OPFS に何も増えない', async ({ page }) => {
  await openHarness(page);
  const r = await page.evaluate(async () => {
    const h = (window as unknown as { __storage: StorageHarness }).__storage;
    const root = await h.freshRoot();
    const lib = h.makeLibrary(root, { free: 1 });
    const before = await h.snapshot();
    let error: { name: string; isQuota: boolean; needed: number; available: number } | null = null;
    try {
      await lib.importFiles([new File(['12345'], 'a.jpg'), new File(['678'], 'b.jpg')]);
    } catch (e) {
      error = { name: (e as Error).name, isQuota: e instanceof h.QuotaError, needed: (e as InstanceType<typeof h.QuotaError>).needed, available: (e as InstanceType<typeof h.QuotaError>).available };
    }
    const after = await h.snapshot();
    return { error, before, after, list: await lib.list() };
  });
  expect(r.error).toEqual({ name: 'QuotaError', isQuota: true, needed: 9, available: 1 });
  expect(r.after).toEqual(r.before);
  expect(r.list).toEqual([]);
});

test('remove(id) でフォルダごと消える', async ({ page }) => {
  await openHarness(page);
  const r = await page.evaluate(async () => {
    const h = (window as unknown as { __storage: StorageHarness }).__storage;
    const root = await h.freshRoot();
    const lib = h.makeLibrary(root);
    const res = await lib.importFiles([new File(['a'], 'a.jpg'), new File(['b'], 'b.png')]);
    const [a, b] = res.added;
    await lib.writeSidecar(a!.id, { app: 'lumen' });
    await lib.remove(a!.id);
    return { a: a!.id, b: b!.id, tree: await h.snapshot(root), list: (await lib.list()).map((x) => x.id) };
  });
  expect(r.tree.some((p) => p.includes(r.a))).toBe(false);
  expect(r.tree).toContain(`library/${r.b}/meta.json`);
  expect(r.list).toEqual([r.b]);
});
