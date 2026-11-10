import { test, expect } from 'vitest';
import { exportImages, EXPORT_WORK_CAP } from '../../src/export/exporter';

// 最終レビュー I4c: 書き出しの作業画像はベース層と色情報にしか使わないので小さく開く（フル解像度はタイルで読む）
test('書き出しは作業画像を EXPORT_WORK_CAP 以下で開く', async () => {
  const seen: number[] = [];
  const deps = {
    backend: {
      list: async () => [{ id: 'a', name: 'a.jpg', size: 1, mtime: 1, group: '' }],
      readOriginal: async () => new File(['x'], 'a.jpg'), readSidecar: async () => null, saveExport: async (n: string) => n,
    },
    decoder: { open: async (_f: Blob, _n: string, o: { workCap: number }) => { seen.push(o.workCap); throw new Error('stop'); },
      readTile: async () => new Uint16Array(), close: () => {} },
    renderer: { setImage: async () => {}, renderTileFull: async () => new Float32Array() },
    workCap: 8192,
    worker: { postMessage() {}, terminate() {}, onmessage: null } as unknown as Worker,
  };
  const r = await exportImages(['a'], { format: 'jpeg', quality: 90, longEdge: null, space: 'srgb', sharpen: 'none', nameRule: '{name}', watermark: null, stripGps: false },
    deps, () => {}, new AbortController().signal);
  expect(r.failed.length).toBe(1);
  expect(seen).toEqual([EXPORT_WORK_CAP]);
  expect(EXPORT_WORK_CAP).toBeLessThanOrEqual(1024);
});
