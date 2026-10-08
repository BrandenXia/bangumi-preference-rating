import { emptyData, parseBackup } from './data.ts';
import type { Data } from './data.ts';

let database: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('bangumi-preference-rating', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('users', { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地存储。请检查浏览器隐私设置。'));
  });
}

export async function load(userId: number): Promise<Data> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('users').objectStore('users').get(userId);
    request.onsuccess = () => {
      try { resolve(request.result ? parseBackup(request.result, userId) : emptyData(userId)); }
      catch (error) { reject(error); } // Never silently overwrite damaged data.
    };
    request.onerror = () => reject(request.error);
  });
}

export async function save(data: Data): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');
    let conflict = false;
    const request = store.get(data.userId);
    request.onsuccess = () => {
      if ((request.result?.revision ?? 0) !== data.revision) { conflict = true; tx.abort(); return; }
      store.put({ ...data, revision: data.revision + 1 });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error(conflict ? '另一个标签页已更新数据，请重新加载页面后再试。' : '本地保存失败，请检查存储空间。'));
  });
  data.revision++;
}
