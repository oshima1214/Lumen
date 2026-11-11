import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// 仕様 9.1: SharedArrayBuffer 用の COOP/COEP（本番は public/_headers）
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// iPhone 実機検証ページ（計画 Task 13）は src/gpu-check/index.html を入口にし、dist/gpu-check/index.html に出す
// （アセットは /assets/ の絶対パスで参照されるので、HTML の置き場所を変えても動く）
function gpuCheckPage(): Plugin {
  return {
    name: 'lumen-gpu-check-page',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const item = bundle['src/gpu-check/index.html'];
      if (item) item.fileName = 'gpu-check/index.html';
    },
  };
}

// PWA（仕様 9 / 計画 Task 28）: アプリ本体（WASM を含む）をプリキャッシュし、オフラインでも起動できるようにする。
// iPhone はホーム画面に追加すると Safari の 7 日間のデータ削除の対象外になる（仕様 2.4）。
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'script-defer',
  includeAssets: ['icons/apple-touch-icon.png'],
  manifest: {
    name: 'Lumen', short_name: 'Lumen', lang: 'ja', display: 'standalone', start_url: '/', scope: '/',
    background_color: '#1C1C1C', theme_color: '#1C1C1C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,wasm,png,svg,webmanifest}'],
    globIgnores: ['__e2e/**', 'gpu-check/**'],
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    navigateFallbackDenylist: [/^\/__e2e\//, /^\/gpu-check\//],
  },
});

export default defineConfig({
  plugins: [svelte(), gpuCheckPage(), pwa],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: 'index.html', 'gpu-check': 'src/gpu-check/index.html' },
    },
  },
});
