// フォルダ方式（仕様 2.4: PC の Chrome / Edge）。写真の隣に <元ファイル名>.json を置く。
import {
  StorageError,
  type HandleStore, type ImageRef, type PresetStore, type StorageBackend,
} from './types';
import { isImageName, sidecarName } from './names';
import {
  DirectoryPresetStore, entriesOf, quarantine, readJson, saveUnique, writeWithWritable, isNotFound,
  type WriteFile,
} from './fs';

export interface FolderDeps {
  pickDirectory(): Promise<FileSystemDirectoryHandle>;
  handleStore: HandleStore;
}

type Slot = 'root' | 'export' | 'presets';

interface PermissionHandle {
  queryPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

const MODE = { mode: 'readwrite' } as const;

export class FolderBackend implements StorageBackend {
  readonly kind = 'folder' as const;
  readonly presets: PresetStore;
  private readonly handles: Record<Slot, FileSystemDirectoryHandle | null> = { root: null, export: null, presets: null };
  private loading: Promise<void> | null = null;
  private readonly write: WriteFile = writeWithWritable;

  constructor(private readonly deps: FolderDeps) {
    this.presets = new DirectoryPresetStore(async () => {
      await this.load();
      return this.handles.presets;
    }, this.write);
  }

  /** IndexedDB に保存したハンドルを復元する（一度だけ） */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      for (const slot of ['root', 'export', 'presets'] as const) {
        const h = await this.deps.handleStore.get(slot);
        if (h && !this.handles[slot]) this.handles[slot] = h;
      }
    })();
    return this.loading;
  }

  private async setSlot(slot: Slot, dir: FileSystemDirectoryHandle): Promise<void> {
    await this.load();
    this.handles[slot] = dir;
    await this.deps.handleStore.set(slot, dir);
  }

  /** 写真フォルダを開く（開いていたフォルダと置き換える） */
  async addSource(): Promise<void> {
    const dir = await this.deps.pickDirectory();
    await this.setSlot('root', dir);
  }

  setExportDir(dir: FileSystemDirectoryHandle): Promise<void> { return this.setSlot('export', dir); }
  setPresetDir(dir: FileSystemDirectoryHandle): Promise<void> { return this.setSlot('presets', dir); }

  /** 書き出し先・プリセットのフォルダ名（未指定は null）。UI の表示用 */
  async dirName(slot: 'export' | 'presets'): Promise<string | null> {
    await this.load();
    return this.handles[slot]?.name ?? null;
  }

  private async present(): Promise<FileSystemDirectoryHandle[]> {
    await this.load();
    return Object.values(this.handles).filter((h): h is FileSystemDirectoryHandle => h !== null);
  }

  async needsPermission(): Promise<boolean> {
    for (const h of await this.present()) {
      const q = (h as unknown as PermissionHandle).queryPermission;
      if (q && (await q.call(h, MODE)) !== 'granted') return true;
    }
    return false;
  }

  /** ユーザー操作（クリック）の中から呼ぶこと */
  async requestPermission(): Promise<boolean> {
    let ok = true;
    for (const h of await this.present()) {
      const p = h as unknown as PermissionHandle;
      if (!p.queryPermission || !p.requestPermission) continue;
      if ((await p.queryPermission.call(h, MODE)) === 'granted') continue;
      if ((await p.requestPermission.call(h, MODE)) !== 'granted') ok = false;
    }
    return ok;
  }

  async list(): Promise<ImageRef[]> {
    await this.load();
    const root = this.handles.root;
    if (!root) return [];
    const out: ImageRef[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, rel: string): Promise<void> => {
      for await (const h of entriesOf(dir)) {
        if (h.name.startsWith('.')) continue;
        if (h.kind === 'directory') {
          await walk(h as FileSystemDirectoryHandle, rel === '' ? h.name : `${rel}/${h.name}`);
        } else if (isImageName(h.name)) {
          const f = await (h as FileSystemFileHandle).getFile();
          const path = rel === '' ? h.name : `${rel}/${h.name}`;
          out.push({ id: `${root.name}/${path}`, name: h.name, size: f.size, mtime: f.lastModified, group: rel });
        }
      }
    };
    await walk(root, '');
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** id（ルートフォルダ名 + 相対パス）→ 画像のあるフォルダと名前。画像が無ければ not-found */
  private async locate(id: string): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    await this.load();
    const root = this.handles.root;
    if (!root) throw new StorageError('not-found', 'フォルダが開かれていません');
    const parts = id.split('/');
    const [rootName, ...rest] = parts;
    const name = rest.pop();
    if (rootName !== root.name || name === undefined || !isImageName(name)
      || rest.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) {
      throw new StorageError('invalid-id', `不正な画像 ID: ${id}`);
    }
    try {
      let dir = root;
      for (const p of rest) dir = await dir.getDirectoryHandle(p);
      await dir.getFileHandle(name);
      return { dir, name };
    } catch (e) {
      if (isNotFound(e)) throw new StorageError('not-found', `画像が見つかりません: ${id}`);
      throw e;
    }
  }

  async readOriginal(id: string): Promise<File> {
    const { dir, name } = await this.locate(id);
    return (await dir.getFileHandle(name)).getFile();
  }

  async readSidecar(id: string): Promise<unknown | null> {
    const { dir, name } = await this.locate(id);
    return readJson(dir, sidecarName(name), id);
  }

  async writeSidecar(id: string, data: unknown): Promise<void> {
    const { dir, name } = await this.locate(id);
    await this.write(dir, sidecarName(name), JSON.stringify(data, null, 2));
  }

  async quarantineSidecar(id: string): Promise<void> {
    const { dir, name } = await this.locate(id);
    await quarantine(dir, sidecarName(name), this.write);
  }

  async saveExport(name: string, blob: Blob): Promise<string> {
    await this.load();
    const dir = this.handles.export;
    if (!dir) throw new StorageError('no-export-dir', '書き出しフォルダが指定されていません');
    return saveUnique(dir, name, blob, this.write);
  }
}
