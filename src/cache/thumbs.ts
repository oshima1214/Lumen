// サムネイルキャッシュ（計画 Task 18）。
// 保存先は IndexedDB（idb）。テストではメモリの ThumbStore を注入する。
// 1 画像 1 レコード（キー `${kind}:${id}`）に { key: thumbKey(ref), blob } を持つ:
// サイズ・更新日時が変わった画像は key が一致しないので再生成して上書きする（古いサムネイルが溜まらない）。
// 生成（readOriginal + decoder.preview）の同時実行は 2 件まで。保存先の失敗は無視してサムネイルは返す。
import { openDB, type IDBPDatabase } from 'idb';
import type { Decoder } from '../decode/client';
import type { ImageRef } from '../storage/types';

export const THUMB_EDGE = 320;
const MAX_CONCURRENT = 2;

export type ThumbKind = 'folder' | 'library';

export interface ThumbRecord { key: string; blob: Blob }

/** サムネイルの保存先（実装は IndexedDB、テストはメモリ） */
export interface ThumbStore {
  get(slot: string): Promise<ThumbRecord | undefined>;
  set(slot: string, rec: ThumbRecord): Promise<void>;
  del(slot: string): Promise<void>;
}

export function thumbKey(kind: ThumbKind, ref: ImageRef): string {
  return `${kind}:${ref.id}:${ref.size}:${ref.mtime}`;
}

function slotOf(kind: ThumbKind, ref: ImageRef): string {
  return `${kind}:${ref.id}`;
}

export function memoryThumbStore(): ThumbStore {
  const m = new Map<string, ThumbRecord>();
  return {
    async get(s) { return m.get(s); },
    async set(s, r) { m.set(s, r); },
    async del(s) { m.delete(s); },
  };
}

const DB_NAME = 'lumen-thumbs';
const STORE = 'thumbs';

export function idbThumbStore(dbName = DB_NAME): ThumbStore {
  let db: Promise<IDBPDatabase> | null = null;
  const open = (): Promise<IDBPDatabase> => {
    db ??= openDB(dbName, 1, { upgrade(d) { d.createObjectStore(STORE); } });
    return db;
  };
  return {
    async get(s) { return (await (await open()).get(STORE, s)) as ThumbRecord | undefined; },
    async set(s, r) { await (await open()).put(STORE, r, s); },
    async del(s) { await (await open()).delete(STORE, s); },
  };
}

export class ThumbCache {
  private active = 0;
  private waiting: (() => void)[] = [];
  private inflight = new Map<string, Promise<Blob>>();

  constructor(
    private decoder: Pick<Decoder, 'preview'>,
    private readOriginal: (id: string) => Promise<File>,
    private kind: ThumbKind,
    private store: ThumbStore = idbThumbStore(),
  ) {}

  get(ref: ImageRef): Promise<Blob> {
    const key = thumbKey(this.kind, ref);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.load(ref, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async invalidate(ref: ImageRef): Promise<void> {
    try { await this.store.del(slotOf(this.kind, ref)); } catch { /* 保存先が使えない */ }
  }

  private async load(ref: ImageRef, key: string): Promise<Blob> {
    const slot = slotOf(this.kind, ref);
    try {
      const rec = await this.store.get(slot);
      if (rec && rec.key === key) return rec.blob;
    } catch { /* 保存先が使えない: 生成だけ行う */ }
    const blob = await this.limited(async () => {
      const file = await this.readOriginal(ref.id);
      return this.decoder.preview(file, ref.name, THUMB_EDGE);
    });
    try { await this.store.set(slot, { key, blob }); } catch { /* 保存できなくても返す */ }
    return blob;
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= MAX_CONCURRENT) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
