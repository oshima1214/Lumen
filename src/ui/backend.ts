// 実ブラウザ用の StorageBackend を作る（仕様 2.4）。テストモードのビルドだけは window.__lumenTestBackend を優先する。
import { FolderBackend } from '../storage/folder';
import { idbHandleStore } from '../storage/handles';
import { LibraryBackend } from '../storage/library';
import type { StorageBackend } from '../storage/types';

/** 計画 Task 22: `import.meta.env.MODE === 'test'` のビルドでだけ有効（本番ビルドでは静的に null） */
export function testBackend(): StorageBackend | null {
  if (import.meta.env.MODE !== 'test') return null;
  return (window as unknown as { __lumenTestBackend?: StorageBackend }).__lumenTestBackend ?? null;
}

/** 写真・RAW を選ぶ <input type="file" multiple>。キャンセルされたら空配列 */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.heic,.heif,.dng,.cr2,.nef';
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

async function share(files: File[]): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?(d: ShareData): boolean };
  if (!nav.share || !nav.canShare?.({ files })) return false;
  try {
    await nav.share({ files });
  } catch (e) {
    // ユーザーが共有シートを閉じた場合は保存しない（ダウンロードに切り替えない）
    if (e instanceof DOMException && e.name === 'AbortError') return true;
    return false;
  }
  return true;
}

export async function createBackend(kind: 'folder' | 'library'): Promise<StorageBackend> {
  if (kind === 'folder') {
    const w = window as unknown as { showDirectoryPicker(o: { mode: 'readwrite' }): Promise<FileSystemDirectoryHandle> };
    return new FolderBackend({ pickDirectory: () => w.showDirectoryPicker({ mode: 'readwrite' }), handleStore: idbHandleStore() });
  }
  return new LibraryBackend({
    root: await navigator.storage.getDirectory(),
    pickFiles,
    share,
    estimate: async () => {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    },
    now: () => new Date(),
  });
}
