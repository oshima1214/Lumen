// iPhone の共有（計画 Task 27、最終レビュー C1・I3）。
// 1) prepareShare: 写真を原寸の JPEG に書き出してファイルにする（時間がかかる）
// 2) deliverShare: ボタンのタップの中で共有シートに渡す。Safari の共有シートはタップ直後でないと開けないため 2 段階にする。
//    ライブラリ方式は 1 回の共有シートにまとめて渡し（仕様 6）、フォルダ方式は書き出しフォルダへ保存する。
// 書き出しはプレビューと取り合わないよう専用の Decoder と Renderer を使い、GPU デバイスはプレビューと共有する。
import { Decoder } from '../../decode/client';
import { Renderer } from '../../engine/renderer';
import { exportImages, type ExportSettings } from '../../export/exporter';
import { LibraryBackend } from '../../storage/library';
import type { App } from '../app.svelte';

export const QUICK_SHARE: ExportSettings = {
  format: 'jpeg', quality: 90, longEdge: null, space: 'srgb', sharpen: 'none',
  nameRule: '{name}', watermark: null, stripGps: false,
};

export interface PreparedShare { files: File[]; failed: { id: string; reason: string }[] }

export async function prepareShare(app: App, ids: string[], onProgress?: (done: number, total: number) => void): Promise<PreparedShare> {
  await app.editor.flush();
  const renderer = new Renderer(app.renderer.currentGpu, new OffscreenCanvas(1, 1), { previewCap: 2048 });
  const decoder = new Decoder();
  const files: File[] = [];
  const capture = {
    list: () => app.backend.list(),
    readOriginal: (id: string) => app.backend.readOriginal(id),
    readSidecar: (id: string) => app.backend.readSidecar(id),
    saveExport: async (name: string, blob: Blob) => { files.push(new File([blob], name, { type: blob.type })); return name; },
  };
  try {
    const r = await exportImages(ids, QUICK_SHARE, { backend: capture, decoder, renderer, workCap: app.platform.workCap },
      onProgress ?? (() => {}), new AbortController().signal);
    return { files, failed: r.failed };
  } finally {
    renderer.destroy();
    decoder.terminate();
  }
}

/** ボタンのクリック処理の中から呼ぶこと */
export async function deliverShare(app: App, files: File[]): Promise<void> {
  if (app.backend instanceof LibraryBackend) return app.backend.shareFiles(files);
  for (const f of files) await app.backend.saveExport(f.name, f);
}
