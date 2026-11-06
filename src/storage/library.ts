// ライブラリ方式（仕様 2.4: iPhone Safari ほか）。写真を OPFS にコピーして管理する。
// 構成: library/<id>/original.<ext>, library/<id>/sidecar.json, library/<id>/meta.json, presets/*.json
import {
  StorageError,
  type ImageRef, type PresetStore, type StorageBackend,
} from './types';
import { extOf, isImageName, uniqueName } from './names';
import {
  DirectoryPresetStore, asciiPresetFileStem, entriesOf, getDirOrNull, quarantine, readJson, removeIfExists,
  type WriteFile,
} from './fs';
import { opfsWriteFile } from './opfs-write';
import { looksTranscoded } from './transcode';

export interface LibraryDeps {
  root: FileSystemDirectoryHandle;
  pickFiles(): Promise<File[]>;
  /** 共有シートで共有する。共有できない（非対応）なら false */
  share(files: File[]): Promise<boolean>;
  estimate(): Promise<{ usage: number; quota: number }>;
  now(): Date;
  /** 共有できないときの保存（既定は <a download>） */
  download?(file: File): void;
  /** ファイルの書き込み方法（既定は createWritable、無ければ Worker の createSyncAccessHandle） */
  writeFile?: WriteFile;
}

export interface ImportResult {
  added: ImageRef[];
  /** iOS が別形式に変換して渡したと思われるもの（「ファイル」から選び直す案内に使う） */
  transcoded: string[];
  rejected: { name: string; reason: 'quota' | 'unsupported' }[];
}

export class QuotaError extends Error {
  constructor(readonly needed: number, readonly available: number) {
    super(`空き容量が足りません（必要 ${needed} バイト、空き ${available} バイト）`);
    this.name = 'QuotaError';
  }
}

interface Meta { name: string; size: number; mtime: number; importedAt: string }

const LIBRARY = 'library';
const PRESETS = 'presets';
const SIDECAR = 'sidecar.json';
const META = 'meta.json';
/** 取り込みに必要な空きの見積もり（合計サイズ × 1.1） */
const QUOTA_MARGIN = 1.1;
const ID_RE = /^[A-Za-z0-9-]+$/;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseMeta(v: unknown): Meta | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o['name'] !== 'string' || typeof o['size'] !== 'number' || typeof o['mtime'] !== 'number'
    || typeof o['importedAt'] !== 'string' || Number.isNaN(Date.parse(o['importedAt']))) return null;
  return { name: o['name'], size: o['size'], mtime: o['mtime'], importedAt: o['importedAt'] };
}

function toRef(id: string, m: Meta): ImageRef {
  return { id, name: m.name, size: m.size, mtime: m.mtime, group: localDate(new Date(m.importedAt)) };
}

function isQuotaExceeded(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

function anchorDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Safari はクリック直後に revoke すると保存に失敗することがあるため遅らせる
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** navigator.storage.persist() を要求する（仕様 2.4 データ保護） */
export async function requestPersistence(): Promise<boolean> {
  try {
    const storage = navigator.storage as StorageManager | undefined;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

export class LibraryBackend implements StorageBackend {
  readonly kind = 'library' as const;
  readonly presets: PresetStore;
  /** 直近の addSource() の結果（変換・非対応・容量の案内に使う） */
  lastImport: ImportResult | null = null;
  private readonly write: WriteFile;
  /** このセッションで共有・保存した書き出しの名前（同名を連番にする） */
  private readonly exported = new Set<string>();

  constructor(private readonly deps: LibraryDeps) {
    this.write = deps.writeFile ?? opfsWriteFile;
    this.presets = new DirectoryPresetStore(
      (create) => (create ? deps.root.getDirectoryHandle(PRESETS, { create: true }) : getDirOrNull(deps.root, PRESETS)),
      this.write,
      asciiPresetFileStem,
    );
  }

  async addSource(): Promise<void> {
    const files = await this.deps.pickFiles();
    this.lastImport = await this.importFiles(files);
  }

  /** 取り込み前に空きを確認し、不足なら 1 枚も書かずに QuotaError */
  async importFiles(files: File[]): Promise<ImportResult> {
    const result: ImportResult = { added: [], transcoded: [], rejected: [] };
    const accepted: File[] = [];
    for (const f of files) {
      if (isImageName(f.name)) accepted.push(f);
      else result.rejected.push({ name: f.name, reason: 'unsupported' });
    }
    if (accepted.length === 0) return result;

    const total = accepted.reduce((s, f) => s + f.size, 0);
    const needed = Math.ceil(total * QUOTA_MARGIN);
    const { usage, quota } = await this.deps.estimate();
    const available = Math.max(0, quota - usage);
    if (needed > available) throw new QuotaError(needed, available);

    const lib = await this.deps.root.getDirectoryHandle(LIBRARY, { create: true });
    for (const f of accepted) {
      const id = crypto.randomUUID();
      const meta: Meta = { name: f.name, size: f.size, mtime: f.lastModified, importedAt: this.deps.now().toISOString() };
      try {
        const dir = await lib.getDirectoryHandle(id, { create: true });
        const ext = extOf(f.name);
        await this.write(dir, `original.${ext}`, f);
        // meta.json は最後に書く（これがあるものだけを取り込み済みとみなす）
        await this.write(dir, META, JSON.stringify(meta));
      } catch (e) {
        await removeIfExists(lib, id, true).catch(() => {});
        if (isQuotaExceeded(e)) {
          result.rejected.push({ name: f.name, reason: 'quota' });
          continue;
        }
        throw e;
      }
      result.added.push(toRef(id, meta));
      if (looksTranscoded(f)) result.transcoded.push(f.name);
    }
    return result;
  }

  async list(): Promise<ImageRef[]> {
    const lib = await getDirOrNull(this.deps.root, LIBRARY);
    if (!lib) return [];
    const out: { ref: ImageRef; at: string }[] = [];
    for await (const h of entriesOf(lib)) {
      if (h.kind !== 'directory' || !ID_RE.test(h.name)) continue;
      let meta: Meta | null = null;
      try {
        meta = parseMeta(await readJson(h as FileSystemDirectoryHandle, META, h.name));
      } catch {
        meta = null;
      }
      if (meta) out.push({ ref: toRef(h.name, meta), at: meta.importedAt });
    }
    const key = (x: { ref: ImageRef; at: string }) => `${x.at}\u0000${x.ref.name}\u0000${x.ref.id}`;
    return out.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).map((x) => x.ref);
  }

  private async locate(id: string): Promise<{ dir: FileSystemDirectoryHandle; meta: Meta }> {
    if (!ID_RE.test(id)) throw new StorageError('invalid-id', `不正な画像 ID: ${id}`);
    const lib = await getDirOrNull(this.deps.root, LIBRARY);
    const dir = lib && (await getDirOrNull(lib, id));
    let meta: Meta | null = null;
    if (dir) {
      try { meta = parseMeta(await readJson(dir, META, id)); } catch { meta = null; }
    }
    if (!dir || !meta) throw new StorageError('not-found', `画像が見つかりません: ${id}`);
    return { dir, meta };
  }

  async readOriginal(id: string): Promise<File> {
    const { dir, meta } = await this.locate(id);
    for await (const h of entriesOf(dir)) {
      if (h.kind === 'file' && h.name.startsWith('original.')) {
        const f = await (h as FileSystemFileHandle).getFile();
        return new File([f], meta.name, { type: f.type, lastModified: meta.mtime });
      }
    }
    throw new StorageError('not-found', `元ファイルがありません: ${id}`);
  }

  async readSidecar(id: string): Promise<unknown | null> {
    const { dir } = await this.locate(id);
    return readJson(dir, SIDECAR, id);
  }

  async writeSidecar(id: string, data: unknown): Promise<void> {
    const { dir } = await this.locate(id);
    await this.write(dir, SIDECAR, JSON.stringify(data, null, 2));
  }

  async quarantineSidecar(id: string): Promise<void> {
    const { dir } = await this.locate(id);
    await quarantine(dir, SIDECAR, this.write);
  }

  async remove(id: string): Promise<void> {
    if (!ID_RE.test(id)) throw new StorageError('invalid-id', `不正な画像 ID: ${id}`);
    const lib = await getDirOrNull(this.deps.root, LIBRARY);
    if (lib) await removeIfExists(lib, id, true);
  }

  /** 共有シートで保存（仕様 6）。共有できなければダウンロード。同じセッションの同名は連番 */
  async saveExport(name: string, blob: Blob): Promise<string> {
    const actual = uniqueName(name, (n) => this.exported.has(n));
    this.exported.add(actual);
    const file = new File([blob], actual, { type: blob.type });
    if (!(await this.deps.share([file]))) (this.deps.download ?? anchorDownload)(file);
    return actual;
  }

  async needsPermission(): Promise<boolean> { return false; }
  async requestPermission(): Promise<boolean> { return true; }
}

