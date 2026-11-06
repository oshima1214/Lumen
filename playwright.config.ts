import { defineConfig, devices } from '@playwright/test';

// 並列作業時にポートが衝突しないよう E2E_PORT で変更可能にする
// tsconfig は Node の型を含めないので process を最小限に宣言する
declare const process: { env: Record<string, string | undefined> };
const port = Number(process.env.E2E_PORT ?? 4173);
// ロケール未設定（LANG 空）の環境では Chromium が日本語のダウンロード名を "download" に置き換えるため、UTF-8 を補う
const browserEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
if (!browserEnv['LANG'] && !browserEnv['LC_ALL']) browserEnv['LANG'] = 'C.UTF-8';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'off' },
  webServer: { command: `npm run build && npx vite preview --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 180_000 },
  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          env: browserEnv,
          args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-vulkan=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
});
