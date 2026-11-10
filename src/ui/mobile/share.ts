// iPhone の共有（計画 Task 27）: 写真を原寸の JPEG に書き出し、保存方式の saveExport に渡す。
// ライブラリ方式では共有シート（「画像を保存」で写真アプリへ）、フォルダ方式では書き出しフォルダへ保存される。
// 書き出しはプレビューと取り合わないよう、専用の Decoder と Renderer を使う（Task 21 の判断）。
import { Decoder } from '../../decode/client';
import { Renderer } from '../../engine/renderer';
import { exportImages, type ExportResult, type ExportSettings } from '../../export/exporter';
import type { App } from '../app.svelte';

export const QUICK_SHARE: ExportSettings = {
  format: 'jpeg', quality: 90, longEdge: null, space: 'srgb', sharpen: 'none',
  nameRule: '{name}', watermark: null, stripGps: false,
};

export async function shareImages(app: App, ids: string[], onProgress?: (done: number, total: number) => void): Promise<ExportResult> {
  await app.editor.flush();
  // プレビューと同じ GPU デバイスを使う（新しいデバイスを作ると iPhone のメモリを圧迫する。最終レビュー C1）
  const renderer = new Renderer(app.renderer.currentGpu, new OffscreenCanvas(1, 1), { previewCap: 2048 });
  const decoder = new Decoder();
  try {
    return await exportImages(ids, QUICK_SHARE, { backend: app.backend, decoder, renderer, workCap: app.platform.workCap },
      onProgress ?? (() => {}), new AbortController().signal);
  } finally {
    renderer.destroy();
    decoder.terminate();
  }
}
