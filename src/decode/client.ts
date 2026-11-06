// メインスレッド側の Decoder。デコード Worker へのメッセージを Promise にする（計画 Task 11）。
import type { Format, WorkingImage } from './types';
import type { Rect, Request, Response } from './worker';

export type { Rect };

export class DecodeError extends Error {
  constructor(message: string, readonly format: Format) { super(message); this.name = 'DecodeError'; }
}

type Omit2<T> = T extends unknown ? Omit<T, 'id'> : never;

export class Decoder {
  private worker: Worker;
  private pending = new Map<number, { ok: (v: unknown) => void; ng: (e: Error) => void }>();
  private next = 0;

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<Response>) => {
      const r = ev.data, p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.ok) p.ok(r.value);
      else p.ng(r.decodeFormat !== undefined ? new DecodeError(r.error, r.decodeFormat as Format) : new Error(r.error));
    };
  }

  private call<T>(req: Omit2<Request>): Promise<T> {
    const id = this.next++;
    return new Promise<T>((ok, ng) => {
      this.pending.set(id, { ok: ok as (v: unknown) => void, ng });
      this.worker.postMessage({ ...req, id });
    });
  }

  open(file: Blob, name: string, opts: { workCap: number }): Promise<{ handle: string; working: WorkingImage }> {
    return this.call({ type: 'open', file, name, workCap: opts.workCap });
  }
  /** 元データ（フル解像度、向き補正前の座標）から RGB を切り出す。範囲外は端の画素で埋める */
  readTile(handle: string, rect: Rect): Promise<Uint16Array> { return this.call({ type: 'readTile', handle, rect }); }
  close(handle: string): void { void this.call({ type: 'close', handle }); }
  /** RAW は埋め込み JPEG、他は縮小 JPEG */
  preview(file: Blob, name: string, maxEdge: number): Promise<Blob> { return this.call({ type: 'preview', file, name, maxEdge }); }
}
