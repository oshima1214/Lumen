// LibraryBackend を偽ハンドルで検証（実 OPFS での同じ契約は tests/e2e/library.spec.ts）
import { describe, test, expect } from 'vitest';
import { LibraryBackend, QuotaError } from '../../src/storage/library';
import { CorruptSidecarError } from '../../src/storage/types';
import { fakeDir } from '../helpers/fake-fs';
import { runStorageContract } from './storage-contract';

const NOW = new Date(2026, 10, 6, 15, 30); // 2026-11-06（ローカル時刻）

function setup(opts: { free?: number; share?: boolean } = {}) {
  const root = fakeDir('opfs');
  const shared: File[][] = [];
  const downloaded: File[] = [];
  let picked: File[] = [];
  const backend = new LibraryBackend({
    root: root.asHandle(),
    pickFiles: async () => picked,
    share: async (files) => { shared.push(files); return opts.share ?? true; },
    estimate: async () => ({ usage: 100, quota: 100 + (opts.free ?? 1e9) }),
    now: () => NOW,
    download: (f) => { downloaded.push(f); },
  });
  return { root, backend, shared, downloaded, pick: (fs: File[]) => { picked = fs; } };
}

const file = (name: string, body: string, type = '', lastModified = 1_600_000_000_000) =>
  new File([body], name, { type, lastModified });

runStorageContract({ test, expect }, async () => {
  const { root, backend } = setup();
  const r = await backend.importFiles([file('a.jpg', 'AAAA', 'image/jpeg'), file('b.jpg', 'BB', 'image/jpeg')]);
  return {
    backend,
    imageIds: r.added.map((x) => x.id),
    async backupExists(id) { return root.file(`library/${id}/sidecar.json.bak`) !== undefined; },
  };
});

describe('LibraryBackend（偽ハンドル）', () => {
  test('取り込みは library/<id>/ に original・meta を置き、group は取り込み日', async () => {
    const { root, backend } = setup();
    const r = await backend.importFiles([file('IMG_0001.CR2', 'raw', '', 123), file('写真 1.HEIC', 'h', 'image/heic')]);
    expect(r.rejected).toEqual([]);
    expect(r.transcoded).toEqual([]);
    expect(r.added.map((x) => [x.name, x.group, x.size])).toEqual([
      ['IMG_0001.CR2', '2026-11-06', 3],
      ['写真 1.HEIC', '2026-11-06', 1],
    ]);
    const id = r.added[0]!.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(root.paths().filter((p) => p.startsWith(`library/${id}/`))).toEqual([
      `library/${id}/meta.json`,
      `library/${id}/original.cr2`,
    ]);
    expect(JSON.parse(root.text(`library/${id}/meta.json`)!)).toEqual({
      name: 'IMG_0001.CR2', size: 3, mtime: 123, importedAt: NOW.toISOString(),
    });
    expect(await backend.list()).toEqual(r.added);
    const orig = await backend.readOriginal(id);
    expect([orig.name, orig.lastModified, await orig.text()]).toEqual(['IMG_0001.CR2', 123, 'raw']);
  });

  test('非対応形式は rejected、JPEG に変換されたものは transcoded', async () => {
    const { backend } = setup();
    const r = await backend.importFiles([file('notes.txt', 'x'), file('IMG_0002.HEIC', 'j', 'image/jpeg')]);
    expect(r.rejected).toEqual([{ name: 'notes.txt', reason: 'unsupported' }]);
    expect(r.transcoded).toEqual(['IMG_0002.HEIC']);
    expect(r.added.map((x) => x.name)).toEqual(['IMG_0002.HEIC']);
  });

  test('空き不足（合計 ×1.1）なら 1 枚も書かずに QuotaError', async () => {
    const files = () => [file('a.jpg', '12345'), file('b.jpg', '1234')]; // 合計 9 → 必要 ceil(9.9) = 10
    const tight = setup({ free: 9 });
    const err = await tight.backend.importFiles(files()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect((err as QuotaError).needed).toBe(10);
    expect((err as QuotaError).available).toBe(9);
    expect(tight.root.paths()).toEqual([]);
    expect(await tight.backend.list()).toEqual([]);
    // ちょうど足りるとき
    const exact = setup({ free: 10 });
    expect((await exact.backend.importFiles(files())).added.length).toBe(2);
  });

  test('meta.json の無い（取り込み途中の）フォルダは一覧に出さない', async () => {
    const { root, backend } = setup();
    root.put('library/partial/original.jpg', 'x');
    root.put('library/bad/meta.json', '{');
    expect(await backend.list()).toEqual([]);
  });

  test('remove(id) でフォルダごと消える', async () => {
    const { root, backend } = setup();
    const r = await backend.importFiles([file('a.jpg', 'A'), file('b.jpg', 'B')]);
    const [a, b] = r.added as unknown as [{ id: string }, { id: string }];
    await backend.writeSidecar(a.id, { v: 1 });
    await backend.remove(a.id);
    expect(root.paths().some((p) => p.startsWith(`library/${a.id}`))).toBe(false);
    expect((await backend.list()).map((x) => x.id)).toEqual([b.id]);
  });

  test('壊れたサイドカーは CorruptSidecarError', async () => {
    const { root, backend } = setup();
    const id = (await backend.importFiles([file('a.jpg', 'A')])).added[0]!.id;
    root.put(`library/${id}/sidecar.json`, 'nope');
    await expect(backend.readSidecar(id)).rejects.toBeInstanceOf(CorruptSidecarError);
  });

  test('不正・不明な id は拒否する', async () => {
    const { backend } = setup();
    await expect(backend.readOriginal('../x')).rejects.toThrow();
    await expect(backend.readSidecar('nope')).rejects.toThrow();
    await expect(backend.writeSidecar('a/b', {})).rejects.toThrow();
  });

  test('saveExport は共有し、共有できなければダウンロード', async () => {
    const ok = setup({ share: true });
    await ok.backend.saveExport('a.jpg', new Blob(['x'], { type: 'image/jpeg' }));
    expect(ok.shared.map((fs) => fs.map((f) => [f.name, f.type]))).toEqual([[['a.jpg', 'image/jpeg']]]);
    expect(ok.downloaded).toEqual([]);
    const ng = setup({ share: false });
    expect(await ng.backend.saveExport('a.jpg', new Blob(['x']))).toBe('a.jpg');
    expect(ng.downloaded.map((f) => f.name)).toEqual(['a.jpg']);
  });

  test('addSource は pickFiles → importFiles で、結果を lastImport に残す', async () => {
    const { backend, pick } = setup();
    pick([file('a.jpg', 'A'), file('x.txt', 'B')]);
    await backend.addSource();
    expect(backend.lastImport?.added.map((x) => x.name)).toEqual(['a.jpg']);
    expect(backend.lastImport?.rejected).toEqual([{ name: 'x.txt', reason: 'unsupported' }]);
    expect((await backend.list()).length).toBe(1);
  });

  test('プリセットは presets/*.json（ファイル名は ASCII のみ）、権限は常に不要', async () => {
    const { root, backend } = setup();
    await backend.presets.save({ name: 'P', builtin: false, params: {} });
    await backend.presets.save({ name: 'モノクロ', builtin: false, params: {} });
    await backend.presets.save({ name: 'ソフト', builtin: false, params: {} });
    await backend.presets.save({ name: 'Film 調', builtin: false, params: {} });
    expect(root.paths()).toEqual(['presets/Film.json', 'presets/P.json', 'presets/preset-2.json', 'presets/preset.json']);
    expect((await backend.presets.list()).map((p) => p.name).sort()).toEqual(['Film 調', 'P', 'ソフト', 'モノクロ'].sort());
    expect(await backend.needsPermission()).toBe(false);
    expect(await backend.requestPermission()).toBe(true);
    expect(backend.kind).toBe('library');
  });
});

