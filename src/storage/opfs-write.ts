// OPFS への書き込み。createWritable() があればそれ（閉じるまで元を変えない）、
// 無ければ専用 Worker の createSyncAccessHandle で一時ファイルに書いてから置き換える。
import { writeWithWritable, type WriteFile } from './fs';

export interface WriteRequest { id: number; path: string[]; name: string; data: ArrayBuffer }
export interface WriteResponse { id: number; ok: boolean; error?: string; errorName?: string }

function hasCreateWritable(): boolean {
  const ctor = (globalThis as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle;
  return ctor === undefined || 'createWritable' in ctor.prototype;
}

async function toBuffer(data: Blob | string): Promise<ArrayBuffer> {
  if (typeof data === 'string') return new TextEncoder().encode(data).buffer as ArrayBuffer;
  return data.arrayBuffer();
}

/** Worker 経由で書く WriteFile を作る（dir は OPFS 内のハンドルであること） */
export function createSyncWorkerWriter(
  makeWorker: () => Worker = () => new Worker(new URL('./opfs-write.worker.ts', import.meta.url), { type: 'module' }),
): WriteFile {
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve(): void; reject(e: unknown): void }>();
  const getWorker = (): Worker => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = (e: MessageEvent<WriteResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve();
      // QuotaExceededError などの種類を保つため DOMException として復元する
      else p.reject(new DOMException(e.data.error ?? 'OPFS への書き込みに失敗しました', e.data.errorName ?? 'Error'));
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'OPFS 書き込み Worker のエラー'));
      pending.clear();
      worker = null;
    };
    worker = w;
    return w;
  };
  return async (dir, name, data) => {
    const opfs = await navigator.storage.getDirectory();
    const path = await opfs.resolve(dir);
    if (path === null) throw new Error('OPFS の外のフォルダには Worker で書き込めません');
    const buf = await toBuffer(data);
    const id = ++seq;
    await new Promise<void>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const req: WriteRequest = { id, path, name, data: buf };
      getWorker().postMessage(req, [buf]);
    });
  };
}

let fallback: WriteFile | null = null;

/** LibraryBackend の既定の書き込み方法 */
export const opfsWriteFile: WriteFile = (dir, name, data) => {
  if (hasCreateWritable()) return writeWithWritable(dir, name, data);
  fallback ??= createSyncWorkerWriter();
  return fallback(dir, name, data);
};
