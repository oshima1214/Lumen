// E2E 用ハーネスをその場でバンドルし、アプリと同じオリジンの /__e2e/ 以下に配信する共通処理
// （tests/e2e/library.spec.ts と同じ方式。テスト用コードは本番バンドルに入らない）。
import { expect, type Page } from '@playwright/test';
import { build, type Rollup } from 'vite';

export type HarnessFiles = Map<string, { body: string | Uint8Array; type: string }>;

export async function bundleHarness(entry: string): Promise<HarnessFiles> {
  const files: HarnessFiles = new Map();
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
      rollupOptions: { input: { harness: entry }, output: { entryFileNames: '[name].js' } },
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
  return files;
}

export async function openHarness(page: Page, files: HarnessFiles, readyTitle: string): Promise<void> {
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[page] ${m.text()}`); });
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
  await expect(page).toHaveTitle(readyTitle);
}
