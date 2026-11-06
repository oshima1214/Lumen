import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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

export default defineConfig({
  plugins: [svelte(), gpuCheckPage()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: { main: 'index.html', 'gpu-check': 'src/gpu-check/index.html' },
    },
  },
});
