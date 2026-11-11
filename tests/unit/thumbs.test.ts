import { describe, it, expect } from 'vitest';
import { ThumbCache, thumbKey, memoryThumbStore, THUMB_EDGE } from '../../src/cache/thumbs';
import type { ImageRef } from '../../src/storage/types';

function ref(id: string, mtime = 1000, size = 10): ImageRef {
  return { id, name: id.split('/').pop()!, size, mtime, group: '' };
}

function stubDecoder(delayMs = 0) {
  const calls: { name: string; maxEdge: number }[] = [];
  let active = 0, maxActive = 0;
  return {
    calls,
    get maxActive() { return maxActive; },
    async preview(file: Blob, name: string, maxEdge: number): Promise<Blob> {
      calls.push({ name, maxEdge });
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, delayMs));
      active--;
      return new Blob([`thumb:${name}:${calls.length}`], { type: 'image/jpeg' });
    },
  };
}

const readOriginal = async (id: string) => new File(['x'], id.split('/').pop()!);

describe('thumbKey', () => {
  it('kind:id:size:mtime', () => {
    expect(thumbKey('folder', ref('root/a.jpg', 5, 7))).toBe('folder:root/a.jpg:7:5');
  });
});

describe('ThumbCache', () => {
  it('同じ ref の 2 回目の get で decoder.preview が呼ばれない', async () => {
    const dec = stubDecoder();
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    const a = await cache.get(ref('root/a.jpg'));
    const b = await cache.get(ref('root/a.jpg'));
    expect(dec.calls).toHaveLength(1);
    expect(dec.calls[0]!.maxEdge).toBe(THUMB_EDGE);
    expect(await b.text()).toBe(await a.text());
  });

  it('キャッシュは別インスタンス（再起動後）でも使われる', async () => {
    const store = memoryThumbStore();
    const dec = stubDecoder();
    await new ThumbCache(dec, readOriginal, 'library', store).get(ref('a'));
    await new ThumbCache(dec, readOriginal, 'library', store).get(ref('a'));
    expect(dec.calls).toHaveLength(1);
  });

  it('mtime が変わると再生成', async () => {
    const dec = stubDecoder();
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    await cache.get(ref('root/a.jpg', 1000));
    await cache.get(ref('root/a.jpg', 2000));
    expect(dec.calls).toHaveLength(2);
    await cache.get(ref('root/a.jpg', 2000));
    expect(dec.calls).toHaveLength(2);
  });

  it('invalidate 後は再生成', async () => {
    const dec = stubDecoder();
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    await cache.get(ref('root/a.jpg'));
    await cache.invalidate(ref('root/a.jpg'));
    await cache.get(ref('root/a.jpg'));
    expect(dec.calls).toHaveLength(2);
  });

  it('同時に 10 件要求しても preview の同時実行が 2 以下', async () => {
    const dec = stubDecoder(5);
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    const blobs = await Promise.all(Array.from({ length: 10 }, (_, i) => cache.get(ref(`root/${i}.jpg`))));
    expect(blobs).toHaveLength(10);
    expect(dec.calls).toHaveLength(10);
    expect(dec.maxActive).toBeLessThanOrEqual(2);
    expect(dec.maxActive).toBe(2);
  });

  it('同じ ref の同時要求は 1 回だけ生成', async () => {
    const dec = stubDecoder(5);
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    await Promise.all([cache.get(ref('root/a.jpg')), cache.get(ref('root/a.jpg'))]);
    expect(dec.calls).toHaveLength(1);
  });

  it('生成失敗は reject し、次の get で再試行できる', async () => {
    let fail = true;
    const dec = { async preview(): Promise<Blob> { if (fail) throw new Error('bad'); return new Blob(['ok']); } };
    const cache = new ThumbCache(dec, readOriginal, 'folder', memoryThumbStore());
    await expect(cache.get(ref('root/a.jpg'))).rejects.toThrow('bad');
    fail = false;
    expect(await (await cache.get(ref('root/a.jpg'))).text()).toBe('ok');
  });

  it('保存先が壊れていても（IndexedDB 不可）サムネイルは返る', async () => {
    const dec = stubDecoder();
    const broken = { get: async () => { throw new Error('idb'); }, set: async () => { throw new Error('idb'); }, del: async () => { throw new Error('idb'); } };
    const cache = new ThumbCache(dec, readOriginal, 'folder', broken);
    expect((await cache.get(ref('root/a.jpg'))).size).toBeGreaterThan(0);
  });
});
