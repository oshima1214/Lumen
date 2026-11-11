// フォルダハンドルを IndexedDB に保存する（仕様 2.4: 再起動後に権限を再取得）。
import { openDB, type IDBPDatabase } from 'idb';
import type { HandleStore } from './types';

const STORE = 'handles';

export function idbHandleStore(dbName = 'lumen-handles'): HandleStore {
  let db: Promise<IDBPDatabase> | null = null;
  const open = () => (db ??= openDB(dbName, 1, { upgrade(d) { d.createObjectStore(STORE); } }));
  return {
    async get(key) {
      return (await (await open()).get(STORE, key)) as FileSystemDirectoryHandle | undefined;
    },
    async set(key, handle) {
      await (await open()).put(STORE, handle, key);
    },
  };
}
