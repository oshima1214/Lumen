/// <reference lib="webworker" />
// createWritable() の無い環境向け: createSyncAccessHandle で <name>.tmp に書き、
// 書き終えてから <name> に置き換える（仕様 4.2）。
import type { WriteRequest, WriteResponse } from './opfs-write';

interface MovableHandle { move?(name: string): Promise<void> }

function writeAll(h: FileSystemSyncAccessHandle, data: Uint8Array): void {
  h.truncate(0);
  let off = 0;
  while (off < data.length) off += h.write(data.subarray(off), { at: off });
  h.flush();
}

async function writeVia(file: FileSystemFileHandle, data: Uint8Array): Promise<void> {
  const h = await file.createSyncAccessHandle();
  try { writeAll(h, data); } finally { h.close(); }
}

async function handle(req: WriteRequest): Promise<void> {
  let dir = await navigator.storage.getDirectory();
  for (const p of req.path) dir = await dir.getDirectoryHandle(p);
  const data = new Uint8Array(req.data);
  const tmpName = `${req.name}.tmp`;
  const tmp = await dir.getFileHandle(tmpName, { create: true });
  await writeVia(tmp, data);
  const movable = tmp as unknown as MovableHandle;
  if (typeof movable.move === 'function') {
    try { await dir.removeEntry(req.name); } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
    await movable.move(req.name);
  } else {
    // move() が無い場合: 一時ファイルに書き終えた後で本体を書き換え、一時ファイルを消す
    await writeVia(await dir.getFileHandle(req.name, { create: true }), data);
    await dir.removeEntry(tmpName);
  }
}

self.onmessage = async (e: MessageEvent<WriteRequest>) => {
  let res: WriteResponse;
  try {
    await handle(e.data);
    res = { id: e.data.id, ok: true };
  } catch (err) {
    res = err instanceof Error
      ? { id: e.data.id, ok: false, error: err.message, errorName: err.name }
      : { id: e.data.id, ok: false, error: String(err) };
  }
  (self as unknown as Worker).postMessage(res);
};
