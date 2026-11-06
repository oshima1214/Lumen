import { describe, test, expect } from 'vitest';
import { FolderBackend } from '../../src/storage/folder';
import { CorruptSidecarError, type HandleStore } from '../../src/storage/types';
import { fakeDir, type FakeDir } from '../helpers/fake-fs';
import { runStorageContract } from './storage-contract';

function memoryHandleStore(): HandleStore & { map: Map<string, FileSystemHandle> } {
  const map = new Map<string, FileSystemHandle>();
  return {
    map,
    async get(key) { return map.get(key) as FileSystemDirectoryHandle | undefined; },
    async set(key, handle) { map.set(key, handle); },
  };
}

async function setup(build: (root: FakeDir) => void = () => {}) {
  const root = fakeDir('photos');
  build(root);
  const exportDir = fakeDir('export');
  const presetDir = fakeDir('presets');
  const handleStore = memoryHandleStore();
  const backend = new FolderBackend({ pickDirectory: async () => root.asHandle(), handleStore });
  await backend.addSource();
  await backend.setExportDir(exportDir.asHandle());
  await backend.setPresetDir(presetDir.asHandle());
  return { root, exportDir, presetDir, handleStore, backend };
}

runStorageContract({ test, expect }, async () => {
  const { root, backend } = await setup((r) => {
    r.put('a.jpg', 'AAAA');
    r.put('sub/b.jpg', 'BB');
  });
  return {
    backend,
    imageIds: ['photos/a.jpg', 'photos/sub/b.jpg'],
    async backupExists(id) {
      const rel = id.slice('photos/'.length);
      return root.paths().some((p) => p.startsWith(`${rel}.json`) && p.endsWith('.bak'));
    },
  };
});

describe('FolderBackend（Review Focus 2: 同名ペア・日本語名・._ ファイル・サイドカー）', () => {
  const build = (r: FakeDir) => {
    r.put('IMG_0001.CR2', 'raw-bytes');
    r.put('IMG_0001.JPG', 'jpeg');
    r.put('IMG_0001.CR2.json', '{"app":"lumen","schema":1,"params":{}}');
    r.put('._IMG_0001.CR2', 'appledouble');
    r.put('写真 1.HEIC', 'heic');
    r.put('notes.txt', 'memo');
    r.put('2024/a.nef', 'nef');
  };

  test('list() は画像 4 件だけを返し、group はフォルダの相対パス', async () => {
    const { backend } = await setup(build);
    const refs = await backend.list();
    expect(refs.map((r) => [r.id, r.name, r.group]).sort()).toEqual([
      ['photos/2024/a.nef', 'a.nef', '2024'],
      ['photos/IMG_0001.CR2', 'IMG_0001.CR2', ''],
      ['photos/IMG_0001.JPG', 'IMG_0001.JPG', ''],
      ['photos/写真 1.HEIC', '写真 1.HEIC', ''],
    ]);
    const cr2 = refs.find((r) => r.name === 'IMG_0001.CR2')!;
    expect(cr2.size).toBe('raw-bytes'.length);
    expect(cr2.mtime).toBe(1_700_000_000_000);
  });

  test('CR2 と JPG のサイドカーは別ファイル', async () => {
    const { root, backend } = await setup(build);
    await backend.writeSidecar('photos/IMG_0001.CR2', { app: 'lumen', which: 'cr2' });
    await backend.writeSidecar('photos/IMG_0001.JPG', { app: 'lumen', which: 'jpg' });
    expect(JSON.parse(root.text('IMG_0001.CR2.json')!)).toEqual({ app: 'lumen', which: 'cr2' });
    expect(JSON.parse(root.text('IMG_0001.JPG.json')!)).toEqual({ app: 'lumen', which: 'jpg' });
    expect(await backend.readSidecar('photos/IMG_0001.CR2')).toEqual({ app: 'lumen', which: 'cr2' });
    expect(await backend.readSidecar('photos/IMG_0001.JPG')).toEqual({ app: 'lumen', which: 'jpg' });
    // 既存の画像・._ ファイルは変更しない
    expect(root.text('IMG_0001.CR2')).toBe('raw-bytes');
    expect(root.text('._IMG_0001.CR2')).toBe('appledouble');
  });

  test('サブフォルダの画像のサイドカーは写真の隣', async () => {
    const { root, backend } = await setup(build);
    await backend.writeSidecar('photos/2024/a.nef', { v: 1 });
    expect(root.text('2024/a.nef.json')).toBeDefined();
    expect(await backend.readSidecar('photos/2024/a.nef')).toEqual({ v: 1 });
  });

  test('日本語・空白入りのファイル名を読める', async () => {
    const { backend } = await setup(build);
    const f = await backend.readOriginal('photos/写真 1.HEIC');
    expect(f.name).toBe('写真 1.HEIC');
    expect(await f.text()).toBe('heic');
  });
});

describe('FolderBackend の細部', () => {
  test('サイドカーは createWritable で 1 回の確定（close）で書く', async () => {
    const { root, backend } = await setup((r) => r.put('a.jpg'));
    await backend.writeSidecar('photos/a.jpg', { v: 1 });
    expect(root.file('a.jpg.json')!.commits).toBe(1);
  });

  test('壊れたサイドカーは CorruptSidecarError、退避すると .json.bak に中身が残る', async () => {
    const { root, backend } = await setup((r) => {
      r.put('a.jpg');
      r.put('a.jpg.json', '{broken');
    });
    await expect(backend.readSidecar('photos/a.jpg')).rejects.toBeInstanceOf(CorruptSidecarError);
    await backend.quarantineSidecar('photos/a.jpg');
    expect(root.text('a.jpg.json.bak')).toBe('{broken');
    expect(root.file('a.jpg.json')).toBeUndefined();
    expect(await backend.readSidecar('photos/a.jpg')).toBeNull();
  });

  test('2 回目の退避は先の .bak を上書きしない', async () => {
    const { root, backend } = await setup((r) => {
      r.put('a.jpg');
      r.put('a.jpg.json', 'first');
    });
    await backend.quarantineSidecar('photos/a.jpg');
    root.put('a.jpg.json', 'second');
    await backend.quarantineSidecar('photos/a.jpg');
    expect(root.text('a.jpg.json.bak')).toBe('first');
    expect(root.text('a.jpg.json-2.bak')).toBe('second');
  });

  test('隠しフォルダ（. で始まる）は一覧に含めない', async () => {
    const { backend } = await setup((r) => {
      r.put('a.jpg');
      r.put('.Trashes/b.jpg');
      r.put('.thumbnails/c.png');
    });
    expect((await backend.list()).map((x) => x.id)).toEqual(['photos/a.jpg']);
  });

  test('ルート外や不正な id は拒否する', async () => {
    const { backend } = await setup((r) => r.put('a.jpg'));
    await expect(backend.readOriginal('photos/../a.jpg')).rejects.toThrow();
    await expect(backend.readOriginal('other/a.jpg')).rejects.toThrow();
    await expect(backend.readOriginal('photos/notes.txt')).rejects.toThrow();
    await expect(backend.writeSidecar('photos/missing.jpg', {})).rejects.toThrow();
  });

  test('saveExport は書き出しフォルダに保存し、既存ファイルを上書きしない', async () => {
    const { exportDir, backend } = await setup();
    exportDir.put('out.jpg', 'old');
    const name = await backend.saveExport('out.jpg', new Blob(['new']));
    expect(name).toBe('out-2.jpg');
    expect(exportDir.text('out.jpg')).toBe('old');
    expect(exportDir.text('out-2.jpg')).toBe('new');
  });

  test('書き出しフォルダ未指定の saveExport はエラー', async () => {
    const backend = new FolderBackend({ pickDirectory: async () => fakeDir().asHandle(), handleStore: memoryHandleStore() });
    await backend.addSource();
    await expect(backend.saveExport('a.jpg', new Blob(['x']))).rejects.toThrow();
  });

  test('プリセットはプリセットフォルダの *.json。不正なファイルは無視し builtin は常に false', async () => {
    const { presetDir, backend } = await setup();
    presetDir.put('x.json', JSON.stringify({ name: 'X', builtin: true, params: { basic: { contrast: 10 } } }));
    presetDir.put('broken.json', '{');
    presetDir.put('noname.json', JSON.stringify({ params: {} }));
    presetDir.put('badparams.json', JSON.stringify({ name: 'Y', params: [] }));
    presetDir.put('readme.txt', 'hi');
    expect(await backend.presets.list()).toEqual([{ name: 'X', builtin: false, params: { basic: { contrast: 10 } } }]);
  });

  test('プリセットフォルダ未指定なら一覧は空、保存はエラー', async () => {
    const backend = new FolderBackend({ pickDirectory: async () => fakeDir().asHandle(), handleStore: memoryHandleStore() });
    expect(await backend.presets.list()).toEqual([]);
    await expect(backend.presets.save({ name: 'a', builtin: false, params: {} })).rejects.toThrow();
  });

  test('フォルダハンドルは保存され、再起動後に権限を再取得できる', async () => {
    const { root, handleStore } = await setup((r) => r.put('a.jpg'));
    root.permission = 'prompt';
    const restarted = new FolderBackend({
      pickDirectory: async () => { throw new Error('should not pick'); },
      handleStore,
    });
    expect(await restarted.needsPermission()).toBe(true);
    expect(await restarted.requestPermission()).toBe(true);
    expect(await restarted.needsPermission()).toBe(false);
    expect((await restarted.list()).map((x) => x.id)).toEqual(['photos/a.jpg']);
  });

  test('権限が拒否されたら requestPermission は false', async () => {
    const { root, handleStore } = await setup((r) => r.put('a.jpg'));
    root.permission = 'prompt';
    root.grantOnRequest = false;
    const restarted = new FolderBackend({ pickDirectory: async () => root.asHandle(), handleStore });
    expect(await restarted.requestPermission()).toBe(false);
    expect(await restarted.needsPermission()).toBe(true);
  });

  test('フォルダ未選択なら一覧は空で権限も不要', async () => {
    const backend = new FolderBackend({ pickDirectory: async () => fakeDir().asHandle(), handleStore: memoryHandleStore() });
    expect(await backend.list()).toEqual([]);
    expect(await backend.needsPermission()).toBe(false);
    expect(backend.kind).toBe('folder');
  });
});

describe('FolderBackend の書き出し先・プリセットフォルダ名（Task 26 の UI 表示用）', () => {
  test('未指定は null、指定後はフォルダ名。保存したハンドルから復元される', async () => {
    const handleStore = memoryHandleStore();
    const root = fakeDir('photos');
    const b = new FolderBackend({ pickDirectory: async () => root.asHandle(), handleStore });
    expect(await b.dirName('export')).toBeNull();
    expect(await b.dirName('presets')).toBeNull();
    await b.setExportDir(fakeDir('書き出し').asHandle());
    expect(await b.dirName('export')).toBe('書き出し');
    const again = new FolderBackend({ pickDirectory: async () => root.asHandle(), handleStore });
    expect(await again.dirName('export')).toBe('書き出し');
    expect(await again.dirName('presets')).toBeNull();
  });
});
