// E2E 用の入口モジュールを vite build() でバンドルし、アプリと同じオリジンの /__e2e/<name>/ 以下に配信する
// 共通ヘルパー（本番バンドルには入らない）。出力はプレビューサーバーが配信する dist/__e2e/<name>/ に書く:
// Worker の中で起動された Worker（libraw-wasm など）の通信は page.route を通らないため、実ファイルが必要。
// /__e2e/files/fixtures/* は tests/fixtures/、/__e2e/files/samples/* は .samples/、
// /__e2e/files/assets/* は test-assets/ を配信する。
import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const FILE_ROOTS: Record<string, string> = { fixtures: 'tests/fixtures', samples: '.samples', assets: 'test-assets' };


export function useHarness(entry: string, readyTitle: string): { open(page: Page): Promise<void> } {
  const name = basename(entry).replace(/\.ts$/, '');
  const base = `/__e2e/${name}/`;
  test.beforeAll(async () => {
    await build({
      configFile: false, root: process.cwd(), base, publicDir: false, logLevel: 'warn',
      build: {
        outDir: resolve('dist/__e2e', name), emptyOutDir: true, minify: false, modulePreload: false,
        rollupOptions: { input: { harness: entry }, output: { entryFileNames: '[name].js' } },
      },
      worker: { format: 'es' },
    });
    expect(existsSync(resolve('dist/__e2e', name, 'harness.js'))).toBe(true);
  });
  return {
    async open(page: Page) {
      await page.route(`**${base}index.html`, (route) => route.fulfill({ headers: HEADERS, contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><title>loading</title><script type="module" src="${base}harness.js"></script>` }));
      await page.route('**/__e2e/files/**', async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__e2e\/files\//, ''));
        const m = /^(\w+)\/(.+)$/.exec(path);
        if (!m || !FILE_ROOTS[m[1]!] || m[2]!.includes('..')) return route.fulfill({ status: 404, body: 'not found' });
        const p = resolve(FILE_ROOTS[m[1]!]!, m[2]!);
        if (!existsSync(p)) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ headers: HEADERS, contentType: 'application/octet-stream', body: readFileSync(p) });
      });
      await page.goto(`${base}index.html`);
      await expect(page).toHaveTitle(readyTitle);
    },
  };
}

/** /__e2e/files/... を Blob として取得する（ページ内で使うコード片） */
export const fetchFileSnippet = `async (p) => { const r = await fetch('/__e2e/files/' + p); if (!r.ok) throw new Error(p + ' ' + r.status); return new File([await r.blob()], p.split('/').pop()); }`;
