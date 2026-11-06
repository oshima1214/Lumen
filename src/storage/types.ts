// 保存方式の抽象（仕様 2.4）。FolderBackend（PC）と LibraryBackend（OPFS）が実装する。
import type { Preset } from '../params/types';

export interface ImageRef { id: string; name: string; size: number; mtime: number; group: string }

export interface PresetStore {
  list(): Promise<Preset[]>;
  /** 同名のプリセットは上書き */
  save(p: Preset): Promise<void>;
  /** 無い名前は何もしない */
  remove(name: string): Promise<void>;
}

export interface StorageBackend {
  kind: 'folder' | 'library';
  /** folder: フォルダ選択 / library: 写真の取り込み */
  addSource(): Promise<void>;
  list(): Promise<ImageRef[]>;
  readOriginal(id: string): Promise<File>;
  /** 存在しなければ null。JSON として読めなければ CorruptSidecarError */
  readSidecar(id: string): Promise<unknown | null>;
  writeSidecar(id: string, data: unknown): Promise<void>;
  /** 破損時に .bak へ退避（既存の .bak は上書きしない）。サイドカーが無ければ何もしない */
  quarantineSidecar(id: string): Promise<void>;
  /** library のみ（ライブラリから削除） */
  remove?(id: string): Promise<void>;
  presets: PresetStore;
  /** 実際に保存した名前（重複時は連番）を返す */
  saveExport(name: string, blob: Blob): Promise<string>;
  needsPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
}

/** フォルダハンドルの保存先（実装は IndexedDB、テストはメモリ） */
export interface HandleStore {
  get(key: string): Promise<FileSystemDirectoryHandle | undefined>;
  set(key: string, handle: FileSystemDirectoryHandle): Promise<void>;
}

export class CorruptSidecarError extends Error {
  constructor(readonly id: string, options?: { cause?: unknown }) {
    super(`サイドカーを読み込めません: ${id}`, options);
    this.name = 'CorruptSidecarError';
  }
}

export type StorageErrorCode = 'not-found' | 'invalid-id' | 'no-export-dir' | 'no-preset-dir';

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
  }
}
