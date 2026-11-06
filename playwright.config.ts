import { defineConfig, devices } from '@playwright/test';

// 並列作業時にポートが衝突しないよう E2E_PORT で変更可能にする
// tsconfig は Node の型を含めないので process を最小限に宣言する
declare const process: { env: Record<string, string | undefined> };
const port = Number(process.env.E2E_PORT ?? 4173);

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
          args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
        },
      },
    },
  ],
});
