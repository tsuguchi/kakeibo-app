// 利用者の家計のデータをすべて消す（F-07、F-85、DATA_MODEL.md 4.4）。
// 中身を読む必要がないので、鍵がなくても（暗号化パスワードと復旧キーをなくしていても）消せる
import { collection, doc, getDocs, writeBatch, type DocumentReference, type Firestore } from 'firebase/firestore'
import type { MetaName } from './repository'

const META_NAMES: MetaName[] = ['categories', 'accounts', 'balances', 'budgets', 'recurring']
// 1 回のまとめた書き込みの上限（500 件）より少なくする
const BATCH_SIZE = 400

// 消した件数を返す。途中で失敗しても、もう一度呼べば残りを消せる。
// users/{uid}（鍵の情報）は最後に消す。途中で止まっても、鍵の情報が残っていれば同じ画面からやり直せるため
export async function deleteUserData(db: Firestore, uid: string, onProgress?: (deleted: number) => void): Promise<number> {
  const refs: DocumentReference[] = []
  for (const name of ['transactions', 'summaries'] as const) {
    const snapshot = await getDocs(collection(db, 'users', uid, name))
    refs.push(...snapshot.docs.map((docSnapshot) => docSnapshot.ref))
  }
  refs.push(...META_NAMES.map((name) => doc(db, 'users', uid, 'meta', name)))

  let deleted = 0
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const ref of refs.slice(i, i + BATCH_SIZE)) batch.delete(ref)
    await batch.commit()
    deleted += Math.min(BATCH_SIZE, refs.length - i)
    onProgress?.(deleted)
  }
  const userBatch = writeBatch(db)
  userBatch.delete(doc(db, 'users', uid))
  await userBatch.commit()
  return deleted + 1
}
