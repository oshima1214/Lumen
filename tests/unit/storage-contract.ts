// StorageBackend の共通契約テスト（仕様 8「保存方式」）。
// Vitest（偽ハンドル）とブラウザ（実 OPFS）の両方で同じ内容を実行するため、
// Node の API や vitest を直接 import せず、test / expect を引数で受け取る。
import type { StorageBackend } from '../../src/storage/types';
import type { Preset } from '../../src/params/types';

export interface ContractAssertion {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeNull(): void;
}

export interface ContractRunner {
  test(name: string, fn: () => Promise<void>): void;
  expect: (actual: unknown) => ContractAssertion;
}

export interface ContractSubject {
  backend: StorageBackend;
  /** list() に出る画像の id（2 件以上、互いに別の画像） */
  imageIds: string[];
  /** quarantineSidecar 後の退避ファイル（.bak）が残っているか */
  backupExists(id: string): Promise<boolean>;
}

export function runStorageContract(t: ContractRunner, makeSubject: () => Promise<ContractSubject>): void {
  const { test, expect } = t;

  const sidecar = (exposure: number) => ({
    app: 'lumen',
    schema: 1,
    source: { name: 'x', size: 1, mtime: 2 },
    params: { basic: { exposure } },
    rating: 3,
  });

  test('list() に用意した画像が出て、readOriginal は同じ名前のファイルを返す', async () => {
    const { backend, imageIds } = await makeSubject();
    const refs = await backend.list();
    const ids = refs.map((r) => r.id);
    for (const id of imageIds) expect(ids.includes(id)).toBe(true);
    const id0 = imageIds[0]!;
    const ref = refs.find((r) => r.id === id0)!;
    const file = await backend.readOriginal(id0);
    expect(file.name).toBe(ref.name);
    expect(file.size).toBe(ref.size);
  });

  test('存在しないサイドカーは null', async () => {
    const { backend, imageIds } = await makeSubject();
    expect(await backend.readSidecar(imageIds[0]!)).toBeNull();
  });

  test('サイドカーの書いて読む往復と上書き', async () => {
    const { backend, imageIds } = await makeSubject();
    const id = imageIds[0]!;
    await backend.writeSidecar(id, sidecar(0.5));
    expect(await backend.readSidecar(id)).toEqual(sidecar(0.5));
    await backend.writeSidecar(id, sidecar(-1));
    expect(await backend.readSidecar(id)).toEqual(sidecar(-1));
  });

  test('サイドカーは画像ごとに別', async () => {
    const { backend, imageIds } = await makeSubject();
    const [a, b] = imageIds as [string, string];
    await backend.writeSidecar(a, sidecar(1));
    await backend.writeSidecar(b, sidecar(2));
    expect(await backend.readSidecar(a)).toEqual(sidecar(1));
    expect(await backend.readSidecar(b)).toEqual(sidecar(2));
  });

  test('quarantineSidecar 後は readSidecar が null で .bak が残る', async () => {
    const { backend, imageIds, backupExists } = await makeSubject();
    const id = imageIds[0]!;
    expect(await backupExists(id)).toBe(false);
    await backend.writeSidecar(id, sidecar(1));
    await backend.quarantineSidecar(id);
    expect(await backend.readSidecar(id)).toBeNull();
    expect(await backupExists(id)).toBe(true);
    // サイドカーが無いときの退避は何もしない
    await backend.quarantineSidecar(id);
    expect(await backupExists(id)).toBe(true);
  });

  test('saveExport は同名の 2 回目に -2 を付ける', async () => {
    const { backend } = await makeSubject();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    expect(await backend.saveExport('out.jpg', blob)).toBe('out.jpg');
    expect(await backend.saveExport('out.jpg', blob)).toBe('out-2.jpg');
    expect(await backend.saveExport('out.jpg', blob)).toBe('out-3.jpg');
  });

  test('プリセットの保存・一覧・上書き・削除', async () => {
    const { backend } = await makeSubject();
    expect(await backend.presets.list()).toEqual([]);
    const a: Preset = { name: 'モノクロ/強め', builtin: true, params: { basic: { saturation: -100 } } };
    const b: Preset = { name: 'B', builtin: false, params: { basic: { exposure: 1 } } };
    await backend.presets.save(a);
    await backend.presets.save(b);
    const byName = (ps: Preset[]) => [...ps].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    expect(byName(await backend.presets.list())).toEqual([
      { name: 'B', builtin: false, params: { basic: { exposure: 1 } } },
      { name: 'モノクロ/強め', builtin: false, params: { basic: { saturation: -100 } } },
    ]);
    await backend.presets.save({ ...b, params: { basic: { exposure: 2 } } });
    expect(byName(await backend.presets.list())).toEqual([
      { name: 'B', builtin: false, params: { basic: { exposure: 2 } } },
      { name: 'モノクロ/強め', builtin: false, params: { basic: { saturation: -100 } } },
    ]);
    await backend.presets.remove('モノクロ/強め');
    expect(await backend.presets.list()).toEqual([{ name: 'B', builtin: false, params: { basic: { exposure: 2 } } }]);
    await backend.presets.remove('存在しない');
    await backend.presets.remove('B');
    expect(await backend.presets.list()).toEqual([]);
  });
}
