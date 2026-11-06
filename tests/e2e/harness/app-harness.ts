// テストモードのアプリ入口（本番バンドル外）。偽のフォルダを FolderBackend で包み、window.__lumenTestBackend に置く。
// クエリ: set=basic|broken、perm=granted|prompt（prompt は再起動後の権限失効の模擬）、
// backend=library（実 OPFS の LibraryBackend。共有シートは window.__shared に記録するスタブ）。
// フォルダ選択は window.__lumenTestPickDirectory が偽のフォルダ（書き出し・プリセット）を返す（Task 26）。
import { FakeDir } from '../../helpers/fake-fs';
import { FolderBackend } from '../../../src/storage/folder';
import { LibraryBackend } from '../../../src/storage/library';

const SETS: Record<string, [name: string, fixture: string | null][]> = {
  basic: [['01 グレー.jpg', 'gray128.jpg'], ['02 グラデーション.png', 'gradient.png'], ['03 カラーチャート.png', 'colorchart.png']],
  broken: [['01 グレー.jpg', 'gray128.jpg'], ['02 壊れた.jpg', null], ['03 カラーチャート.png', 'colorchart.png']],
};

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.click();
  });
}

async function startLibrary(q: URLSearchParams): Promise<void> {
  const opfs = await navigator.storage.getDirectory();
  const name = `lib-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const root = await opfs.getDirectoryHandle(name, { create: true });
  const shared: File[] = [];
  const backend = new LibraryBackend({
    root, pickFiles, now: () => new Date(),
    share: async (files) => { shared.push(...files); return true; },
    estimate: async () => ({ usage: 0, quota: 1e12 }),
  });
  const files: File[] = [];
  for (const [n, fixture] of SETS[q.get('set') ?? 'basic'] ?? []) {
    if (fixture === null) files.push(new File([new TextEncoder().encode('x')], n));
    else files.push(new File([await (await fetch(`/__e2e/files/fixtures/${fixture}`)).blob()], n, { type: n.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
  }
  await backend.importFiles(files);
  const w = window as unknown as { __lumenTestBackend: unknown; __shared: File[] };
  w.__lumenTestBackend = backend;
  w.__shared = shared;
  await import('../../../src/main');
}

async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
  if (q.get('backend') === 'library') return startLibrary(q);
  const root = new FakeDir('写真');
  for (const [name, fixture] of SETS[q.get('set') ?? 'basic'] ?? []) {
    const bytes = fixture === null
      ? new TextEncoder().encode('これは画像ではありません')
      : new Uint8Array(await (await fetch(`/__e2e/files/fixtures/${fixture}`)).arrayBuffer());
    root.put(name, bytes);
  }
  if (q.get('perm') === 'prompt') root.permission = 'prompt';
  const handles = new Map<string, FileSystemDirectoryHandle>([['root', root as unknown as FileSystemDirectoryHandle]]);
  const backend = new FolderBackend({
    pickDirectory: async () => root as unknown as FileSystemDirectoryHandle,
    handleStore: { get: async (k) => handles.get(k), set: async (k, h) => { handles.set(k, h); } },
  });
  // 書き出し先・プリセットのフォルダ選択（showDirectoryPicker の代わり）。選んだフォルダは __lumenTestDirs で見られる
  const dirs: Record<string, FakeDir> = {};
  const w = window as unknown as {
    __lumenTestBackend: unknown; __lumenTestRoot: unknown; __lumenTestDirs: unknown;
    __lumenTestPickDirectory(purpose: 'export' | 'presets'): Promise<FileSystemDirectoryHandle>;
  };
  w.__lumenTestBackend = backend;
  w.__lumenTestRoot = root;
  w.__lumenTestDirs = dirs;
  w.__lumenTestPickDirectory = async (purpose) =>
    (dirs[purpose] ??= new FakeDir(purpose === 'export' ? '書き出し' : 'プリセット')) as unknown as FileSystemDirectoryHandle;
  await import('../../../src/main');
}
void start();
