// E2E 専用の入口。本番バンドルには入らない（tests/e2e/library.spec.ts が vite の build() で
// その場でバンドルし、page.route で /__e2e/ 以下として配信する）。実 OPFS 上で保存方式を検証する。
import { LibraryBackend, QuotaError } from '../../../src/storage/library';
import { createSyncWorkerWriter } from '../../../src/storage/opfs-write';
import { entriesOf } from '../../../src/storage/fs';
import { runStorageContract, type ContractAssertion } from '../../unit/storage-contract';

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function expect(actual: unknown): ContractAssertion {
  const fail = (what: string, expected: unknown) => {
    throw new Error(`expected ${JSON.stringify(actual)} ${what} ${JSON.stringify(expected)}`);
  };
  return {
    toBe(expected) { if (!Object.is(actual, expected)) fail('to be', expected); },
    toEqual(expected) { if (!deepEqual(actual, expected)) fail('to equal', expected); },
    toBeNull() { if (actual !== null) fail('to be', null); },
  };
}

export interface ContractResult { name: string; error: string | null }

/** テスト用の空フォルダ（OPFS ルート直下） */
async function freshRoot(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(`t-${crypto.randomUUID()}`, { create: true });
}

/** OPFS 全体のファイル・フォルダのパス一覧 */
async function snapshot(dir?: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> {
  const d = dir ?? (await navigator.storage.getDirectory());
  const out: string[] = [];
  for await (const h of entriesOf(d)) {
    out.push(prefix + h.name + (h.kind === 'directory' ? '/' : ''));
    if (h.kind === 'directory') out.push(...(await snapshot(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`)));
  }
  return out.sort();
}

function makeLibrary(root: FileSystemDirectoryHandle, opts: { free?: number; sync?: boolean } = {}): LibraryBackend {
  return new LibraryBackend({
    root,
    pickFiles: async () => [],
    share: async () => true,
    estimate: async () => ({ usage: 0, quota: opts.free ?? 1e12 }),
    now: () => new Date(),
    ...(opts.sync ? { writeFile: createSyncWorkerWriter() } : {}),
  });
}

/** 実 OPFS で共通契約を実行する。sync=true は createSyncAccessHandle（Worker）経路を強制 */
async function runLibraryContract(sync: boolean): Promise<{ results: ContractResult[]; files: string[] }> {
  const cases: { name: string; fn: () => Promise<void> }[] = [];
  runStorageContract({ test: (name, fn) => cases.push({ name, fn }), expect }, async () => {
    const root = await freshRoot();
    const backend = makeLibrary(root, { sync });
    const r = await backend.importFiles([
      new File(['AAAA'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['BB'], '写真 1.HEIC', { type: 'image/heic' }),
    ]);
    return {
      backend,
      imageIds: r.added.map((x) => x.id),
      async backupExists(id) {
        const dir = await (await root.getDirectoryHandle('library')).getDirectoryHandle(id);
        try { await dir.getFileHandle('sidecar.json.bak'); return true; } catch { return false; }
      },
    };
  });
  const results: ContractResult[] = [];
  for (const c of cases) {
    try {
      await c.fn();
      results.push({ name: c.name, error: null });
    } catch (e) {
      results.push({ name: c.name, error: e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e) });
    }
  }
  return { results, files: await snapshot() };
}

const harness = { LibraryBackend, QuotaError, freshRoot, snapshot, makeLibrary, runLibraryContract };
export type StorageHarness = typeof harness;

(window as unknown as { __storage: StorageHarness }).__storage = harness;
document.title = 'storage-harness-ready';
