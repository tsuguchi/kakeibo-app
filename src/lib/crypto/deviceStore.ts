// 「この端末で覚える」（F-82）。取り出し不可の CryptoKey を IndexedDB にそのまま保存する。
// 取り出し不可の鍵は、保存した後もブラウザの中のプログラムから鍵の中身を読み出せない
import type { DataKeys } from './keys'

const DB_NAME = 'kakeibo-keys'
const STORE = 'keys'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveDeviceKeys(uid: string, keys: DataKeys): Promise<void> {
  await run('readwrite', (store) => store.put({ encKey: keys.encKey, idKey: keys.idKey }, uid))
}

export async function loadDeviceKeys(uid: string): Promise<DataKeys | null> {
  try {
    const value = (await run('readonly', (store) => store.get(uid))) as Partial<DataKeys> | undefined
    return value?.encKey && value.idKey ? { encKey: value.encKey, idKey: value.idKey } : null
  } catch (error) {
    // 保存できない環境（プライベートブラウズの一部など）では、覚えていないものとして扱う
    console.warn('この端末に覚えた鍵を読み込めませんでした', error)
    return null
  }
}

// その利用者の鍵だけを消す（前の設定の古い鍵を見つけたとき）
export async function deleteDeviceKeys(uid: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(uid))
  } catch (error) {
    console.warn('この端末に覚えた鍵を消せませんでした', error)
  }
}

// ログアウトのときは、この端末に覚えたすべての利用者の鍵を消す
export async function clearDeviceKeys(): Promise<void> {
  try {
    await run('readwrite', (store) => store.clear())
  } catch (error) {
    console.warn('この端末に覚えた鍵を消せませんでした', error)
  }
}
