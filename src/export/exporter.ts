// 一括書き出し（仕様 6）: 1 枚ずつ順に、タイル単位で GPU 現像 → Worker で縮小・シャープ・8bit 化 → 透かし・エンコード・
// メタデータ → 保存。失敗した写真は飛ばして最後に一覧で返す。AbortSignal で次の写真の前に中止する。
// プレビューと取り合わないよう、decoder と renderer は書き出し専用のインスタンスを渡す。
import type { Decoder } from '../decode/client';
import type { Renderer } from '../engine/renderer';
import type { StorageBackend } from '../storage/types';
import { fromSidecar } from '../params/sidecar';
import { defaultParams } from '../params/defaults';
import { planTiles } from './tiles';
import { formatName } from './naming';
import { sharpenMargin, type SharpenLevel } from './sharpen';
import type { Watermark } from './watermark';
import type { ExportWorkerRequest } from './worker';

/** 書き出しの作業画像の長辺上限。ベース層（長辺 512）と色情報にしか使わないので小さくてよい（最終レビュー I4c） */
export const EXPORT_WORK_CAP = 1024;

export interface ExportSettings {
  format: 'jpeg' | 'png'; quality: number; longEdge: number | null; space: 'srgb' | 'p3';
  sharpen: SharpenLevel; nameRule: string; watermark: Watermark | null; stripGps: boolean;
}

export interface ExportDeps {
  backend: Pick<StorageBackend, 'list' | 'readOriginal' | 'readSidecar' | 'saveExport'>;
  decoder: Pick<Decoder, 'open' | 'readTile' | 'close'>;
  renderer: Pick<Renderer, 'setImage' | 'renderTileFull'>;
  workCap: number;
  worker?: Worker;
}

export interface ExportResult { saved: string[]; failed: { id: string; reason: string }[]; cancelled: boolean }

type Omit2<T> = T extends unknown ? Omit<T, 'id'> : never;

function workerClient(worker: Worker) {
  let next = 0;
  const pending = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
  worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
    const p = pending.get(ev.data.id); if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.ok(ev.data.value); else p.ng(new Error(ev.data.error));
  };
  return <T>(req: Omit2<ExportWorkerRequest>, transfer: Transferable[] = []) => new Promise<T>((ok, ng) => {
    const id = next++; pending.set(id, { ok: ok as (v: unknown) => void, ng }); worker.postMessage({ ...req, id }, transfer);
  });
}

export async function exportImages(ids: string[], s: ExportSettings, deps: ExportDeps,
  onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<ExportResult> {
  const res: ExportResult = { saved: [], failed: [], cancelled: false };
  const refs = new Map((await deps.backend.list()).map((r) => [r.id, r]));
  const worker = deps.worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const call = workerClient(worker);
  try {
    for (let i = 0; i < ids.length; i++) {
      if (signal.aborted) { res.cancelled = true; break; }
      const id = ids[i]!;
      try {
        const ref = refs.get(id);
        if (!ref) throw new Error('写真が見つかりません');
        const raw = await deps.backend.readSidecar(id);
        const params = raw == null ? defaultParams() : fromSidecar(raw).params;
        const file = await deps.backend.readOriginal(id);
        const { handle, working } = await deps.decoder.open(file, ref.name, { workCap: Math.min(deps.workCap, EXPORT_WORK_CAP), retain: true });
        try {
          await deps.renderer.setImage(working);
          const full = { w: working.fullWidth, h: working.fullHeight, o: working.orientation };
          const probe = planTiles(full, params.crop, s.longEdge);
          const margin = sharpenMargin(s.sharpen, Math.max(probe.outW, probe.outH));
          const plan = planTiles(full, params.crop, s.longEdge, { outMargin: margin });
          const { sx, sy } = plan;
          await call({ type: 'begin', outW: plan.outW, outH: plan.outH });
          for (const t of plan.tiles) {
            const data = await deps.decoder.readTile(handle, t.src);
            const rgba = await deps.renderer.renderTileFull(params, { data, rect: t.src }, t.frame, s.space);
            await call({ type: 'tile', rgba, frame: t.frame, core: t.core, sx, sy, sharpen: s.sharpen, margin }, [rgba.buffer]);
          }
          const bytes = await call<Uint8Array>({ type: 'finish', format: s.format, quality: s.quality, watermark: s.watermark,
            exif: working.exif, space: s.space, stripGps: s.stripGps });
          const name = formatName(s.nameRule, { name: ref.name, seq: i + 1, date: working.exif.date }, s.format === 'jpeg' ? 'jpg' : 'png');
          res.saved.push(await deps.backend.saveExport(name, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: s.format === 'jpeg' ? 'image/jpeg' : 'image/png' })));
        } finally {
          deps.decoder.close(handle);
        }
      } catch (e) {
        res.failed.push({ id, reason: e instanceof Error ? e.message : String(e) });
      }
      onProgress(i + 1, ids.length);
    }
  } finally {
    if (!deps.worker) worker.terminate();
  }
  return res;
}
