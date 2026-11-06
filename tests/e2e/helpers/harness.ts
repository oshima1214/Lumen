// E2E 用の入口モジュールを vite build() でメモリ上にバンドルし、アプリと同じオリジンの
// /__e2e/ 以下に配信する共通ヘルパー（本番バンドルには入らない）。
// /__e2e/files/fixtures/* は tests/fixtures/、/__e2e/files/samples/* は .samples/、
// /__e2e/files/assets/* は test-assets/ を配信する。
import { test, expect, type Page } from '@playwright/test';
import { build, type Rollup } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const FILE_ROOTS: Record<string, string> = { fixtures: 'tests/fixtures', samples: '.samples', assets: 'test-assets' };

const typeOf = (name: string) =>
  name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';

export function useHarness(entry: string, readyTitle: string): { open(page: Page): Promise<void> } {
  const files = new Map<string, { body: string | Uint8Array; type: string }>();
  test.beforeAll(async () => {
    const result = await build({
      configFile: false, root: process.cwd(), base: '/__e2e/', publicDir: false, logLevel: 'warn',
      build: {
        write: false, minify: false, modulePreload: false,
        rollupOptions: { input: { harness: entry }, output: { entryFileNames: '[name].js' } },
      },
      worker: { format: 'es' },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
    for (const out of outputs) for (const item of out.output) {
      files.set(item.fileName, { body: item.type === 'chunk' ? item.code : item.source, type: typeOf(item.fileName) });
    }
    expect(files.has('harness.js')).toBe(true);
  });
  return {
    async open(page: Page) {
      await page.route('**/__e2e/**', async (route) => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__e2e\//, ''));
        if (path === '' || path === 'index.html') {
          return route.fulfill({ headers: HEADERS, contentType: 'text/html',
            body: '<!doctype html><meta charset="utf-8"><title>loading</title><script type="module" src="/__e2e/harness.js"></script>' });
        }
        const m = /^files\/(\w+)\/(.+)$/.exec(path);
        if (m && FILE_ROOTS[m[1]!] && !m[2]!.includes('..')) {
          const p = resolve(FILE_ROOTS[m[1]!]!, m[2]!);
          if (!existsSync(p)) return route.fulfill({ status: 404, body: 'not found' });
          return route.fulfill({ headers: HEADERS, contentType: 'application/octet-stream', body: readFileSync(p) });
        }
        const f = files.get(path);
        if (!f) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ headers: HEADERS, contentType: f.type, body: typeof f.body === 'string' ? f.body : Buffer.from(f.body) });
      });
      await page.goto('/__e2e/index.html');
      await expect(page).toHaveTitle(readyTitle);
    },
  };
}

/** /__e2e/files/... を Blob として取得する（ページ内で使うコード片） */
export const fetchFileSnippet = `async (p) => { const r = await fetch('/__e2e/files/' + p); if (!r.ok) throw new Error(p + ' ' + r.status); return new File([await r.blob()], p.split('/').pop()); }`;
