// テストモードのアプリ入口（本番バンドル外）。偽のフォルダを FolderBackend で包み、window.__lumenTestBackend に置く。
// クエリ: set=basic|broken、perm=granted|prompt（prompt は再起動後の権限失効の模擬）。
import { FakeDir } from '../../helpers/fake-fs';
import { FolderBackend } from '../../../src/storage/folder';

const SETS: Record<string, [name: string, fixture: string | null][]> = {
  basic: [['01 グレー.jpg', 'gray128.jpg'], ['02 グラデーション.png', 'gradient.png'], ['03 カラーチャート.png', 'colorchart.png']],
  broken: [['01 グレー.jpg', 'gray128.jpg'], ['02 壊れた.jpg', null], ['03 カラーチャート.png', 'colorchart.png']],
};

async function start(): Promise<void> {
  const q = new URLSearchParams(location.search);
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
  const w = window as unknown as { __lumenTestBackend: unknown; __lumenTestRoot: unknown };
  w.__lumenTestBackend = backend;
  w.__lumenTestRoot = root;
  await import('../../../src/main');
}
void start();
