// メモリ上の FileSystemDirectoryHandle / FileSystemFileHandle 互換（storage/ が使う範囲のみ）。
// createWritable() は close() まで内容を反映しない（実ブラウザの一時ファイル方式と同じ振る舞い）。

type Entry = FakeDir | FakeFile;

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

function checkName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`invalid name: ${name}`);
  }
}

export class FakeFile {
  readonly kind = 'file' as const;
  data: Uint8Array = new Uint8Array();
  type = '';
  lastModified = Date.now();
  /** close() 前に中身が書き換わっていないことを確認するための記録 */
  commits = 0;
  constructor(public name: string) {}

  async getFile(): Promise<File> {
    return new File([this.data.slice()], this.name, { type: this.type, lastModified: this.lastModified });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const target = this;
    let buf = new Uint8Array();
    let closed = false;
    const write = async (chunk: unknown): Promise<void> => {
      if (closed) throw new TypeError('stream closed');
      let bytes: Uint8Array;
      if (typeof chunk === 'string') bytes = new TextEncoder().encode(chunk);
      else if (chunk instanceof Blob) bytes = new Uint8Array(await chunk.arrayBuffer());
      else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk);
      else if (ArrayBuffer.isView(chunk)) bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice();
      else throw new TypeError('unsupported chunk');
      // 既定（keepExistingData: false）は空から書く。単純化のため追記のみ対応。
      const next = new Uint8Array(buf.length + bytes.length);
      next.set(buf);
      next.set(bytes, buf.length);
      buf = next;
    };
    const stream = {
      write,
      async close() {
        if (closed) throw new TypeError('stream closed');
        closed = true;
        target.data = buf;
        target.lastModified = Date.now();
        target.commits++;
      },
      async abort() { closed = true; },
    };
    return stream as unknown as FileSystemWritableFileStream;
  }

  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
  async queryPermission(): Promise<PermissionState> { return 'granted'; }
  async requestPermission(): Promise<PermissionState> { return 'granted'; }
}

export class FakeDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, Entry>();
  /** 権限状態（再起動後の失効を模擬する） */
  permission: PermissionState = 'granted';
  /** requestPermission() に対する応答 */
  grantOnRequest = true;
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    checkName(name);
    const e = this.children.get(name);
    if (e) {
      if (e.kind !== 'directory') throw domError('TypeMismatchError', `${name} is a file`);
      return e;
    }
    if (!opts?.create) throw domError('NotFoundError', `${name} not found`);
    const d = new FakeDir(name);
    this.children.set(name, d);
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    checkName(name);
    const e = this.children.get(name);
    if (e) {
      if (e.kind !== 'file') throw domError('TypeMismatchError', `${name} is a directory`);
      return e;
    }
    if (!opts?.create) throw domError('NotFoundError', `${name} not found`);
    const f = new FakeFile(name);
    this.children.set(name, f);
    return f;
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const e = this.children.get(name);
    if (!e) throw domError('NotFoundError', `${name} not found`);
    if (e.kind === 'directory' && e.children.size > 0 && !opts?.recursive) {
      throw domError('InvalidModificationError', `${name} is not empty`);
    }
    this.children.delete(name);
  }

  async *entries(): AsyncGenerator<[string, Entry]> {
    for (const [k, v] of [...this.children]) yield [k, v];
  }
  async *keys(): AsyncGenerator<string> {
    for (const k of [...this.children.keys()]) yield k;
  }
  async *values(): AsyncGenerator<Entry> {
    for (const v of [...this.children.values()]) yield v;
  }
  [Symbol.asyncIterator](): AsyncGenerator<[string, Entry]> { return this.entries(); }

  async isSameEntry(other: unknown): Promise<boolean> { return other === this; }
  async queryPermission(): Promise<PermissionState> { return this.permission; }
  async requestPermission(): Promise<PermissionState> {
    if (this.grantOnRequest) this.permission = 'granted';
    return this.permission;
  }

  // ---- テスト用の便利関数 ----

  /** パス（'a/b.jpg'）にファイルを作る。途中のフォルダも作る */
  put(path: string, content: string | Uint8Array = '', lastModified = 1_700_000_000_000): FakeFile {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let dir: FakeDir = this;
    for (const p of parts) {
      let next = dir.children.get(p);
      if (!next) { next = new FakeDir(p); dir.children.set(p, next); }
      if (next.kind !== 'directory') throw new Error(`${p} is a file`);
      dir = next;
    }
    const f = new FakeFile(fileName);
    f.data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    f.lastModified = lastModified;
    dir.children.set(fileName, f);
    return f;
  }

  /** パスのファイルを取得（無ければ undefined） */
  file(path: string): FakeFile | undefined {
    const parts = path.split('/');
    let e: Entry | undefined = this;
    for (const p of parts) {
      if (!e || e.kind !== 'directory') return undefined;
      e = e.children.get(p);
    }
    return e?.kind === 'file' ? e : undefined;
  }

  text(path: string): string | undefined {
    const f = this.file(path);
    return f ? new TextDecoder().decode(f.data) : undefined;
  }

  /** 全ファイルの相対パス（ソート済み） */
  paths(prefix = ''): string[] {
    const out: string[] = [];
    for (const [k, v] of this.children) {
      if (v.kind === 'file') out.push(prefix + k);
      else out.push(...v.paths(`${prefix}${k}/`));
    }
    return out.sort();
  }

  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

export function fakeDir(name = 'root'): FakeDir {
  return new FakeDir(name);
}
