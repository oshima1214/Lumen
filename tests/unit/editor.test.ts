import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEditor, type EditorDeps, type RendererPort } from '../../src/store/editor.svelte';
import { CorruptSidecarError, type ImageRef, type StorageBackend } from '../../src/storage/types';
import { FolderBackend } from '../../src/storage/folder';
import { DecodeError } from '../../src/decode/client';
import { GpuOutOfMemoryError } from '../../src/engine/errors';
import { defaultParams } from '../../src/params/defaults';
import { DEFAULT_COPY_GROUPS } from '../../src/params/partial';
import { toSidecar, fromSidecar } from '../../src/params/sidecar';
import type { WorkingImage } from '../../src/decode/types';
import { fakeDir } from '../helpers/fake-fs';

// ---- スタブ ----

interface MemBackend extends StorageBackend {
  sidecars: Map<string, unknown>;
  writes: { id: string; data: unknown }[];
  quarantined: string[];
  /** 次の writeSidecar の結果を差し替える（1 回分ずつ消費） */
  writePlan: ((id: string) => Promise<void> | undefined)[];
  failIds: Set<string>;
  readError: Map<string, Error>;
}

function memBackend(ids: string[]): MemBackend {
  const refs: ImageRef[] = ids.map((id, i) => ({ id, name: `${id}.jpg`, size: 100 + i, mtime: 1000 + i, group: '' }));
  const b: MemBackend = {
    kind: 'folder',
    sidecars: new Map(), writes: [], quarantined: [], writePlan: [], failIds: new Set(), readError: new Map(),
    async addSource() {},
    async list() { return refs.map((r) => ({ ...r })); },
    async readOriginal(id) { return new File([id], `${id}.jpg`); },
    async readSidecar(id) {
      const e = b.readError.get(id);
      if (e) throw e;
      return b.sidecars.has(id) ? structuredClone(b.sidecars.get(id)) : null;
    },
    async writeSidecar(id, data) {
      const plan = b.writePlan.shift()?.(id);
      if (plan) await plan;
      if (b.failIds.has(id)) throw new Error(`write failed: ${id}`);
      b.writes.push({ id, data: structuredClone(data) });
      b.sidecars.set(id, structuredClone(data));
    },
    async quarantineSidecar(id) { b.quarantined.push(id); b.sidecars.delete(id); b.readError.delete(id); },
    presets: { async list() { return []; }, async save() {}, async remove() {} },
    async saveExport(n) { return n; },
    async needsPermission() { return false; },
    async requestPermission() { return true; },
  };
  return b;
}

function working(w = 400, h = 300): WorkingImage {
  return {
    width: w, height: h, fullWidth: w, fullHeight: h, orientation: 1, kind: 'display',
    pixels: new Uint16Array(3), exif: {} as WorkingImage['exif'],
  };
}

function stubDecoder() {
  const opens: { name: string; workCap: number }[] = [];
  const closed: string[] = [];
  let n = 0;
  return {
    opens, closed,
    failNames: new Set<string>(),
    async open(_f: Blob, name: string, opts: { workCap: number }) {
      opens.push({ name, workCap: opts.workCap });
      if (this.failNames.has(name)) throw new DecodeError('対応していない形式です', 'unknown');
      return { handle: `h${n++}`, working: working() };
    },
    close(h: string) { closed.push(h); },
  };
}

function stubRenderer(): RendererPort & { images: WorkingImage[]; renders: number; oomOnce: boolean } {
  const r = {
    images: [] as WorkingImage[], renders: 0, oomOnce: false,
    async setImage(img: WorkingImage) {
      if (r.oomOnce) { r.oomOnce = false; throw new GpuOutOfMemoryError(); }
      r.images.push(img);
    },
    render() { r.renders++; },
  };
  return r;
}

function setup(ids = ['A', 'B', 'C']) {
  const backend = memBackend(ids);
  const decoder = stubDecoder();
  const renderer = stubRenderer();
  const deps: EditorDeps = {
    backend, decoder, renderer, platform: { workCap: 4096 },
    setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as unknown as typeof setTimeout,
    clearTimeout: ((h: ReturnType<typeof setTimeout>) => clearTimeout(h)) as unknown as typeof clearTimeout,
  };
  const editor = createEditor(deps);
  return { backend, decoder, renderer, editor };
}

function exposureOf(data: unknown): number {
  return fromSidecar(data).params.basic.exposure;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ---- 自動保存 ----

describe('自動保存', () => {
  it('update 後 499ms では未保存、500ms で 1 回保存', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(499);
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0]!.id).toBe('A');
    expect(exposureOf(backend.writes[0]!.data)).toBe(1);
  });

  it('連続 update は最後の 1 回だけ保存', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    for (let i = 1; i <= 5; i++) {
      editor.update((p) => { p.basic.exposure = i / 10; });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.writes).toHaveLength(1);
    expect(exposureOf(backend.writes[0]!.data)).toBe(0.5);
  });

  it('サイドカーの source は ImageRef の name/size/mtime', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('B');
    editor.setRating(4);
    await vi.advanceTimersByTimeAsync(500);
    const j = backend.writes[0]!.data as { source: unknown; rating: number };
    expect(j.source).toEqual({ name: 'B.jpg', size: 101, mtime: 1001 });
    expect(j.rating).toBe(4);
  });

  it('（Review Focus 3）A を update → 200ms 後に open(B) → A に最終値、B には書かれない。B を update → 保存は B のみ', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 0.5; });
    editor.update((p) => { p.basic.exposure = 0.75; });
    await vi.advanceTimersByTimeAsync(200);
    await editor.open('B');
    expect(editor.currentId).toBe('B');
    expect(backend.writes.map((w) => w.id)).toEqual(['A']);
    expect(exposureOf(backend.sidecars.get('A'))).toBe(0.75);
    expect(backend.sidecars.has('B')).toBe(false);
    expect(editor.params.basic.exposure).toBe(0);
    // 切り替え後に古いタイマーが発火しても何も書かれない
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.writes.map((w) => w.id)).toEqual(['A']);

    editor.update((p) => { p.basic.contrast = 20; });
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.writes.map((w) => w.id)).toEqual(['A', 'B']);
    const b = fromSidecar(backend.sidecars.get('B')).params;
    expect(b.basic.contrast).toBe(20);
    expect(b.basic.exposure).toBe(0);
    expect(exposureOf(backend.sidecars.get('A'))).toBe(0.75);
  });

  it('保存中の連続編集: 書き込み中の update も失われず、書き込み完了後に最終値が保存される', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    let release!: () => void;
    backend.writePlan.push(() => new Promise<void>((r) => { release = r; }));
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(500); // 1 回目の書き込みが始まって止まっている
    editor.update((p) => { p.basic.exposure = 2; });
    await vi.advanceTimersByTimeAsync(500); // 2 回目は 1 回目の完了待ち
    expect(backend.writes).toHaveLength(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(backend.writes.map((w) => exposureOf(w.data))).toEqual([1, 2]);
  });

  it('保存中に open(B) しても A の最終値が書かれてから切り替わる', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    let release!: () => void;
    backend.writePlan.push(() => new Promise<void>((r) => { release = r; }));
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(500);
    editor.update((p) => { p.basic.exposure = 3; });
    const opening = editor.open('B');
    await vi.advanceTimersByTimeAsync(0);
    release();
    await opening;
    expect(backend.writes.map((w) => [w.id, exposureOf(w.data)])).toEqual([['A', 1], ['A', 3]]);
    expect(editor.currentId).toBe('B');
  });

  it('flush() で保留中の保存を即時実行', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    await editor.flush();
    expect(backend.writes).toHaveLength(1);
  });

  it('保存失敗（1 回目 reject）→ saveError が立ち、5 秒後の再試行成功で null に戻る', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    backend.writePlan.push(() => Promise.reject(new Error('disk full')));
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(500);
    expect(editor.status.saveError).not.toBeNull();
    expect(editor.params.basic.exposure).toBe(1); // 内容はメモリに保持
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4999);
    expect(backend.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.writes).toHaveLength(1);
    expect(exposureOf(backend.writes[0]!.data)).toBe(1);
    expect(editor.status.saveError).toBeNull();
  });

  it('保存失敗後、次の update でも再試行される', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    backend.writePlan.push(() => Promise.reject(new Error('disk full')));
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(500);
    expect(editor.status.saveError).not.toBeNull();
    editor.update((p) => { p.basic.contrast = 5; });
    await vi.advanceTimersByTimeAsync(500);
    expect(backend.writes).toHaveLength(1);
    expect(editor.status.saveError).toBeNull();
  });

  it('readOnly（新しすぎる schema）のときは保存しない', async () => {
    const { editor, backend } = setup();
    backend.sidecars.set('A', { app: 'lumen', schema: 99, params: { basic: { exposure: 1 } }, rating: 2 });
    await editor.refresh();
    await editor.open('A');
    expect(editor.readOnly).toBe(true);
    expect(editor.params.basic.exposure).toBe(1);
    editor.update((p) => { p.basic.exposure = 2; });
    await vi.advanceTimersByTimeAsync(10_000);
    await editor.flush();
    expect(backend.writes).toHaveLength(0);
  });
});

// ---- 読み込み ----

describe('読み込み', () => {
  it('既存サイドカーの値と rating で開く。保存した source と違えば sourceChanged', async () => {
    const { editor, backend } = setup();
    const p = defaultParams(); p.basic.exposure = 0.3;
    backend.sidecars.set('A', toSidecar(p, { name: 'A.jpg', size: 999, mtime: 1 }, 3));
    backend.sidecars.set('B', toSidecar(p, { name: 'B.jpg', size: 101, mtime: 1001 }, 0));
    await editor.refresh();
    await editor.open('A');
    expect(editor.params.basic.exposure).toBe(0.3);
    expect(editor.rating).toBe(3);
    expect(editor.status.sourceChanged).toBe(true);
    await editor.open('B');
    expect(editor.status.sourceChanged).toBe(false);
  });

  it('破損サイドカー（JSON でない）→ quarantineSidecar が呼ばれ、params が既定値、corrupted === true', async () => {
    const { editor, backend } = setup();
    backend.readError.set('A', new CorruptSidecarError('A'));
    await editor.refresh();
    await editor.open('A');
    expect(backend.quarantined).toEqual(['A']);
    expect(editor.params).toEqual(defaultParams());
    expect(editor.status.corrupted).toBe(true);
    expect(editor.readOnly).toBe(false);
  });

  it('破損サイドカー（SidecarError: Lumen のファイルだが schema が不正）→ quarantine して既定値、corrupted', async () => {
    const { editor, backend } = setup();
    backend.sidecars.set('A', { app: 'lumen', schema: 0 });
    await editor.refresh();
    await editor.open('A');
    expect(backend.quarantined).toEqual(['A']);
    expect(editor.params).toEqual(defaultParams());
    expect(editor.status.corrupted).toBe(true);
    await editor.open('B');
    expect(editor.status.corrupted).toBe(false);
  });

  it('FolderBackend + fake FS: 壊れた JSON は .bak に退避され、既定値で開く', async () => {
    const root = fakeDir('photos');
    root.put('a.jpg', 'AAAA');
    root.put('a.jpg.json', '{not json');
    const backend = new FolderBackend({
      pickDirectory: async () => root.asHandle(),
      handleStore: { async get() { return undefined; }, async set() {} },
    });
    await backend.addSource();
    const editor = createEditor({
      backend, decoder: stubDecoder(), renderer: null, platform: { workCap: 4096 },
      setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as unknown as typeof setTimeout,
      clearTimeout: ((h: ReturnType<typeof setTimeout>) => clearTimeout(h)) as unknown as typeof clearTimeout,
    });
    await editor.refresh();
    await editor.open('photos/a.jpg');
    expect(editor.status.corrupted).toBe(true);
    expect(editor.params).toEqual(defaultParams());
    expect(root.paths().some((p) => p.endsWith('.bak'))).toBe(true);
  });

  it('破損以外の読み込み失敗（権限切れなど）→ 既定値・保存しない・notice。次に開くと読み直す', async () => {
    const { editor, backend } = setup();
    backend.readError.set('A', new Error('NotAllowedError'));
    await editor.refresh();
    await editor.open('A');
    expect(editor.readOnly).toBe(true);
    expect(editor.status.notice).not.toBeNull();
    expect(backend.quarantined).toEqual([]);
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.writes).toHaveLength(0);
    backend.readError.delete('A');
    await editor.open('B');
    await editor.open('A');
    expect(editor.readOnly).toBe(false);
    expect(editor.status.notice).toBeNull();
  });

  it('退避（quarantine）に失敗したら壊れたサイドカーを上書きしない（readOnly）', async () => {
    const { editor, backend } = setup();
    backend.readError.set('A', new CorruptSidecarError('A'));
    backend.quarantineSidecar = async () => { throw new Error('locked'); };
    await editor.refresh();
    await editor.open('A');
    expect(editor.status.corrupted).toBe(true);
    expect(editor.readOnly).toBe(true);
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.writes).toHaveLength(0);
  });

  it('連続して open しても最後に開いた画像になり、古いデコード結果は閉じられる', async () => {
    const { editor, decoder, renderer } = setup();
    await editor.refresh();
    const a = editor.open('A');
    const b = editor.open('B');
    await Promise.all([a, b]);
    expect(editor.currentId).toBe('B');
    expect(renderer.images).toHaveLength(1);
    expect(decoder.opens.map((o) => o.name)).toEqual(['B.jpg']);
  });

  it('デコード失敗はその画像だけ decodeError、他の画像は開ける', async () => {
    const { editor, decoder } = setup();
    decoder.failNames.add('B.jpg');
    await editor.refresh();
    await editor.open('B');
    expect(editor.status.decodeError).toContain('対応していない');
    await editor.open('C');
    expect(editor.status.decodeError).toBeNull();
  });

  it('setImage が 1 回目に GpuOutOfMemoryError → workCap を半分（4096 → 2048）で再度 open、notice が入る', async () => {
    const { editor, decoder, renderer } = setup();
    renderer.oomOnce = true;
    await editor.refresh();
    await editor.open('A');
    expect(decoder.opens.map((o) => o.workCap)).toEqual([4096, 2048]);
    expect(renderer.images).toHaveLength(1);
    expect(editor.status.notice).toBe('解像度を下げて表示しています');
    expect(editor.status.decodeError).toBeNull();
  });

  it('画像ごとの Undo 履歴: B に切り替えて戻っても A の履歴が残る', async () => {
    const { editor } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    await editor.open('B');
    editor.update((p) => { p.basic.exposure = 2; });
    await editor.open('A');
    expect(editor.params.basic.exposure).toBe(1);
    editor.undo();
    expect(editor.params.basic.exposure).toBe(0);
    editor.redo();
    expect(editor.params.basic.exposure).toBe(1);
  });

  it('ジェスチャー中の update は Undo 1 件、undo は保存もされる', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.beginGesture();
    for (let i = 1; i <= 50; i++) editor.update((p) => { p.basic.exposure = i / 50; });
    editor.endGesture();
    editor.undo();
    expect(editor.params.basic.exposure).toBe(0);
    editor.undo(); // これ以上戻れない
    expect(editor.params.basic.exposure).toBe(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(exposureOf(backend.sidecars.get('A'))).toBe(0);
  });

  it('resetAll で既定値（Undo 可能）', async () => {
    const { editor } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; p.crop.angle = 5; });
    editor.resetAll();
    expect(editor.params).toEqual(defaultParams());
    editor.undo();
    expect(editor.params.basic.exposure).toBe(1);
  });
});

// ---- コピー＆ペースト・プリセット ----

describe('コピー＆ペースト', () => {
  it('paste([B, C]) が DEFAULT_COPY_GROUPS のみを適用し、B・C の crop と wb は不変。1 枚の書き込み失敗は failed に入り、他は保存される', async () => {
    const { editor, backend } = setup(['A', 'B', 'C', 'D']);
    const pb = defaultParams();
    pb.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5, angle: 3, aspect: 'free' };
    pb.wb = { mode: 'custom', temp: 3000, tint: 10 };
    backend.sidecars.set('B', toSidecar(pb, { name: 'B.jpg', size: 101, mtime: 1001 }, 0));
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => {
      p.basic.exposure = 1.5; p.hsl.red.s = -40;
      p.wb = { mode: 'custom', temp: 7000, tint: -20 };
      p.crop = { x: 0.2, y: 0, w: 0.8, h: 1, angle: -2, aspect: 'free' };
    });
    editor.copy(DEFAULT_COPY_GROUPS);
    backend.failIds.add('D');
    const r = await editor.paste(['B', 'C', 'D']);
    expect(r.failed).toEqual(['D']);
    const b = fromSidecar(backend.sidecars.get('B')).params;
    const c = fromSidecar(backend.sidecars.get('C')).params;
    expect(b.basic.exposure).toBe(1.5);
    expect(c.basic.exposure).toBe(1.5);
    expect(b.hsl.red.s).toBe(-40);
    expect(b.crop).toEqual(pb.crop);
    expect(b.wb).toEqual(pb.wb);
    expect(c.crop).toEqual(defaultParams().crop);
    expect(c.wb).toEqual(defaultParams().wb);
    expect(backend.sidecars.has('D')).toBe(false);
    // 現在の画像は変わらない
    expect(editor.currentId).toBe('A');
    expect(editor.params.wb.temp).toBe(7000);
  });

  it('現在の画像へのペーストは Undo できる', async () => {
    const { editor } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    editor.copy(['basic']);
    await editor.open('B');
    await editor.paste(['B']);
    expect(editor.params.basic.exposure).toBe(1);
    editor.undo();
    expect(editor.params.basic.exposure).toBe(0);
  });

  it('applyPreset は含まれる項目だけを上書きし、ids 省略時は現在の画像', async () => {
    const { editor, backend } = setup();
    await editor.refresh();
    await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    await editor.applyPreset({ name: 'x', builtin: false, params: { basic: { saturation: -100 } } });
    expect(editor.params.basic.saturation).toBe(-100);
    expect(editor.params.basic.exposure).toBe(1);
    await editor.applyPreset({ name: 'x', builtin: false, params: { basic: { contrast: 30 } } }, ['C']);
    expect(fromSidecar(backend.sidecars.get('C')).params.basic.contrast).toBe(30);
  });
});

// ---- Renderer との結合（Task 15 の ViewState には viewport が必須） ----
describe('Renderer に渡す表示状態', () => {
  it('既定の view は viewport を持ち、setView で更新できる', () => {
    const { editor } = setup();
    expect(editor.view.viewport.w).toBeGreaterThan(0);
    expect(editor.view.viewport.h).toBeGreaterThan(0);
    editor.setView({ viewport: { w: 800, h: 600 } });
    expect(editor.view.viewport).toEqual({ w: 800, h: 600 });
  });
});

// ---- 切り抜きツールのプレビュー（Task 25）: 確定前の枠はプレビューだけに使い、params・保存・履歴に入れない ----
describe('setPreviewCrop', () => {
  it('上書き中は Renderer に上書きした crop を渡し、params は変えず保存もしない', async () => {
    const { editor, backend } = setup();
    const seen: unknown[] = [];
    const r = { async setImage() {}, render(p: { crop: unknown }) { seen.push(p.crop); } };
    const { editor: ed2 } = (() => {
      const deps: EditorDeps = { backend, decoder: stubDecoder(), renderer: r as unknown as RendererPort, platform: { workCap: 4096 },
        setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as unknown as typeof setTimeout,
        clearTimeout: ((h: ReturnType<typeof setTimeout>) => clearTimeout(h)) as unknown as typeof clearTimeout };
      return { editor: createEditor(deps) };
    })();
    void editor;
    await ed2.refresh(); await ed2.open('A');
    const full = { x: 0, y: 0, w: 1, h: 1, angle: 10, aspect: 'original' as const };
    ed2.setPreviewCrop(full);
    expect(seen.at(-1)).toEqual(full);
    expect(ed2.params.crop.angle).toBe(0);
    expect(ed2.canUndo).toBe(false);
    ed2.update((p) => { p.basic.exposure = 1; });
    expect(seen.at(-1)).toEqual(full);              // 編集しても上書きは保たれる
    ed2.setPreviewCrop(null);
    expect((seen.at(-1) as { angle: number }).angle).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(exposureOf(await backend.readSidecar('A'))).toBe(1);
  });

  it('画像を切り替えると上書きは解除される', async () => {
    const { editor } = setup();
    await editor.refresh(); await editor.open('A');
    editor.setPreviewCrop({ x: 0, y: 0, w: 1, h: 1, angle: 5, aspect: 'free' });
    await editor.open('B');
    expect(editor.previewCrop).toBeNull();
  });
});

// ---- 最終レビュー I2: 他のアプリの同名 JSON（例: Google Takeout の IMG_1234.JPG.json）を壊れたサイドカーとして退避しない ----
describe('他のアプリの JSON', () => {
  it('退避せず、読み取り専用で開いて案内を出し、上書きしない', async () => {
    const { editor, backend } = setup();
    const takeout = { title: 'A.jpg', photoTakenTime: { timestamp: '1700000000' }, geoData: { latitude: 35 } };
    backend.sidecars.set('A', takeout);
    await editor.refresh(); await editor.open('A');
    expect(backend.quarantined).toEqual([]);
    expect(editor.status.corrupted).toBe(false);
    expect(editor.readOnly).toBe(true);
    expect(editor.status.notice).toMatch(/他のアプリ/);
    editor.update((p) => { p.basic.exposure = 1; });
    await vi.advanceTimersByTimeAsync(6000);
    expect(backend.sidecars.get('A')).toEqual(takeout);
  });

  it('JSON の配列なども他のアプリのものとして扱う。Lumen の app で中身が不正なら従来どおり退避', async () => {
    const { editor, backend } = setup();
    backend.sidecars.set('A', [1, 2, 3]);
    backend.sidecars.set('B', { app: 'lumen', schema: 'x' });
    await editor.refresh(); await editor.open('A');
    expect(backend.quarantined).toEqual([]);
    await editor.open('B');
    expect(backend.quarantined).toEqual(['B']);
    expect(editor.status.corrupted).toBe(true);
  });
});

// ---- 最終レビュー I1: 開き直したフォルダ（同じ名前の別フォルダ）で前の画像の状態を使い回さない ----
describe('reset（保存方式の取り込み元が変わったとき）', () => {
  it('保留中の保存を前のフォルダに書いてから、状態を捨てて新しいサイドカーを読み直す', async () => {
    const { editor, backend } = setup();
    await editor.refresh(); await editor.open('A');
    editor.update((p) => { p.basic.exposure = 1; });
    await editor.reset();                                   // 500ms 待たずに切り替え
    expect(exposureOf(backend.sidecars.get('A'))).toBe(1);  // 前のフォルダに書き切った
    expect(editor.currentId).toBeNull();
    expect(editor.working).toBeNull();
    // 新しいフォルダの同じ id には別の編集が入っている
    const p2 = defaultParams(); p2.basic.exposure = -2;
    backend.sidecars.set('A', toSidecar(p2, { name: 'A.jpg', size: 100, mtime: 1000 }, 0));
    const writesBefore = backend.writes.length;
    await editor.refresh(); await editor.open('A');
    expect(editor.params.basic.exposure).toBe(-2);
    expect(editor.canUndo).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(backend.writes.length).toBe(writesBefore);       // 開いただけでは上書きしない
  });
});
