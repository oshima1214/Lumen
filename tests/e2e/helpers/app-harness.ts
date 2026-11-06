// アプリ本体を「テストモード」（vite build --mode test 相当）でビルドして開く E2E ヘルパー（計画 Task 22）。
// 入口 tests/e2e/harness/app.html → app-harness.ts が偽のフォルダ（tests/helpers/fake-fs）で FolderBackend を作って
// window.__lumenTestBackend に置き、src/main.ts を読み込む。import.meta.env.MODE === 'test' のビルドだけが
// それを使う（本番ビルドでは静的に消える）。出力は spec ごとに dist/__e2e/app-<name>/（並列 worker の衝突を避ける）。
import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { routeFiles } from './harness';

const ENTRY = 'tests/e2e/harness/app.html';

export interface AppQuery {
  /** 'basic' = 正常な 3 枚、'broken' = 正常 2 枚 + 壊れた 1 枚 */
  set?: 'basic' | 'broken';
  /** 'prompt' でフォルダ権限の失効（再起動後）を模擬する */
  perm?: 'granted' | 'prompt';
}

export function useAppHarness(name: string): { open(page: Page, q?: AppQuery): Promise<void> } {
  const dir = `app-${name}`;
  const base = `/__e2e/${dir}/`;
  test.beforeAll(async () => {
    await build({
      configFile: false, root: process.cwd(), base, mode: 'test', publicDir: false, logLevel: 'warn',
      plugins: [svelte()],
      build: {
        outDir: resolve('dist/__e2e', dir), emptyOutDir: true, minify: false, modulePreload: false,
        rollupOptions: { input: { app: ENTRY } },
      },
      worker: { format: 'es' },
    });
    expect(existsSync(resolve('dist/__e2e', dir, ENTRY))).toBe(true);
  });
  return {
    async open(page: Page, q: AppQuery = {}) {
      await routeFiles(page);
      const qs = new URLSearchParams({ set: q.set ?? 'basic', perm: q.perm ?? 'granted' });
      await page.goto(`${base}${ENTRY}?${qs}`);
      await page.waitForFunction(() => !!(window as unknown as { __lumenApp?: unknown }).__lumenApp);
    },
  };
}
