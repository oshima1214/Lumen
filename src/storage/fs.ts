// FileSystemDirectoryHandle の共通処理（FolderBackend / LibraryBackend で共有）。
import type { Preset } from '../params/types';
import { CorruptSidecarError, StorageError, type PresetStore } from './types';
import { uniqueName } from './names';

/** ファイルを書く関数。閉じるまで元の内容を変えない（仕様 4.2 の一時ファイル → 置換） */
export type WriteFile = (dir: FileSystemDirectoryHandle, name: string, data: Blob | string) => Promise<void>;

export function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

function isTypeMismatch(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'TypeMismatchError';
}

/** ディレクトリの中身（lib.dom の AsyncIterable 宣言を tsconfig に足さずに使う） */
export function entriesOf(dir: FileSystemDirectoryHandle): AsyncIterable<FileSystemHandle> {
  return (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
}

export async function namesIn(dir: FileSystemDirectoryHandle): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const h of entriesOf(dir)) out.add(h.name);
  return out;
}

/** createWritable() で書く（close() で確定し、それまで元ファイルは変わらない） */
export const writeWithWritable: WriteFile = async (dir, name, data) => {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(data);
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
  await w.close();
};

export async function getFileOrNull(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (e) {
    if (isNotFound(e) || isTypeMismatch(e)) return null;
    throw e;
  }
}

export async function getDirOrNull(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await dir.getDirectoryHandle(name);
  } catch (e) {
    if (isNotFound(e) || isTypeMismatch(e)) return null;
    throw e;
  }
}

export async function removeIfExists(dir: FileSystemDirectoryHandle, name: string, recursive = false): Promise<void> {
  try {
    await dir.removeEntry(name, { recursive });
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** JSON を読む。無ければ null、読めなければ CorruptSidecarError */
export async function readJson(dir: FileSystemDirectoryHandle, name: string, id: string): Promise<unknown | null> {
  const f = await getFileOrNull(dir, name);
  if (!f) return null;
  const text = await f.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new CorruptSidecarError(id, { cause: e });
  }
}

/** name を name.bak（既にあれば name-2.bak …）へ退避して元を消す。無ければ何もしない */
export async function quarantine(dir: FileSystemDirectoryHandle, name: string, write: WriteFile): Promise<void> {
  const f = await getFileOrNull(dir, name);
  if (!f) return;
  const taken = await namesIn(dir);
  const bak = uniqueName(`${name}.bak`, (n) => taken.has(n));
  await write(dir, bak, f);
  await dir.removeEntry(name);
}

/** 書き出し時の重複回避つき保存。実際の名前を返す */
export async function saveUnique(dir: FileSystemDirectoryHandle, name: string, blob: Blob, write: WriteFile): Promise<string> {
  const taken = await namesIn(dir);
  const actual = uniqueName(name, (n) => taken.has(n));
  await write(dir, actual, blob);
  return actual;
}

/** プリセット JSON の最小限の検証。builtin は読み込み時に常に false */
export function parsePreset(v: unknown): Preset | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const params = o['params'];
  if (typeof o['name'] !== 'string' || o['name'] === '') return null;
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  return { name: o['name'], builtin: false, params: params as Preset['params'] };
}

/** プリセット名からファイル名を作る（使えない文字は '_'） */
export function presetFileStem(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 100);
  return s === '' ? 'preset' : s;
}

/**
 * ディレクトリの *.json をプリセットとして扱う。ファイル名は名前から作るが、
 * 同一性は中身の name で判定する（ファイル名の衝突や手動でのリネームに強くするため）。
 */
export class DirectoryPresetStore implements PresetStore {
  constructor(
    private readonly getDir: (create: boolean) => Promise<FileSystemDirectoryHandle | null>,
    private readonly write: WriteFile,
  ) {}

  private async scan(dir: FileSystemDirectoryHandle): Promise<{ file: string; preset: Preset }[]> {
    const out: { file: string; preset: Preset }[] = [];
    for await (const h of entriesOf(dir)) {
      if (h.kind !== 'file' || !h.name.toLowerCase().endsWith('.json') || h.name.startsWith('.')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await (await (h as FileSystemFileHandle).getFile()).text());
      } catch {
        continue;
      }
      const preset = parsePreset(parsed);
      if (preset) out.push({ file: h.name, preset });
    }
    return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  }

  async list(): Promise<Preset[]> {
    const dir = await this.getDir(false);
    if (!dir) return [];
    return (await this.scan(dir)).map((x) => x.preset);
  }

  async save(p: Preset): Promise<void> {
    const dir = await this.getDir(true);
    if (!dir) throw new StorageError('no-preset-dir', 'プリセットの保存先が指定されていません');
    const existing = (await this.scan(dir)).filter((x) => x.preset.name === p.name);
    const body = JSON.stringify({ name: p.name, params: p.params }, null, 2);
    let file = existing[0]?.file;
    if (!file) {
      const taken = await namesIn(dir);
      file = uniqueName(`${presetFileStem(p.name)}.json`, (n) => taken.has(n));
    }
    await this.write(dir, file, body);
    for (const extra of existing.slice(1)) await removeIfExists(dir, extra.file);
  }

  async remove(name: string): Promise<void> {
    const dir = await this.getDir(false);
    if (!dir) return;
    for (const x of await this.scan(dir)) {
      if (x.preset.name === name) await removeIfExists(dir, x.file);
    }
  }
}
