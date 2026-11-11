// 書き出しパイプラインの E2E 入口（本番バンドル外）。メモリ上の保存方式で exportImages を動かす。
import { exportImages, type ExportSettings } from '../../../src/export/exporter';
import { Decoder } from '../../../src/decode/client';
import { Renderer } from '../../../src/engine/renderer';
import { createGpu } from '../../../src/engine/gpu';
import exifr from 'exifr';

async function file(p: string, name?: string): Promise<File> {
  const r = await fetch('/__e2e/files/' + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return new File([await r.blob()], name ?? p.split('/').pop()!);
}

async function run(files: File[], settings: ExportSettings, abortAt?: number) {
  const saved: { name: string; blob: Blob }[] = [];
  const refs = files.map((f, i) => ({ id: `id${i}`, name: f.name, size: f.size, mtime: 0, group: '' }));
  const backend = {
    list: async () => refs,
    readOriginal: async (id: string) => files[Number(id.slice(2))]!,
    readSidecar: async () => null,
    saveExport: async (name: string, blob: Blob) => { saved.push({ name, blob }); return name; },
  };
  const canvas = new OffscreenCanvas(1, 1);
  const deps = { backend, decoder: new Decoder(), renderer: new Renderer(await createGpu(), canvas, { previewCap: 2048 }), workCap: 4096 };
  const ac = new AbortController();
  const progress: number[] = [];
  const res = await exportImages(refs.map((r) => r.id), settings, deps, (done) => { progress.push(done); if (abortAt !== undefined && done === abortAt) ac.abort(); }, ac.signal);
  const out = [];
  for (const s of saved) {
    const bmp = await createImageBitmap(s.blob);
    const meta = await exifr.parse(s.blob, { icc: true }).catch(() => null);
    out.push({ name: s.name, type: s.blob.type, w: bmp.width, h: bmp.height, icc: String(meta?.ProfileDescription ?? '') });
  }
  return { res, out, progress };
}

const api = { file, run };
export type ExportHarness = typeof api;
(window as unknown as { __x: ExportHarness }).__x = api;
document.title = 'export-harness-ready';
