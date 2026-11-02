// users/{uid} の crypto（包んだマスターキーなど）の読み書き（DATA_MODEL.md 3 章）
import {
  Bytes as FirestoreBytes,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import type { Bytes } from './crypto/encoding'
import type { CryptoHeader, KdfParams, Sealed } from './crypto/keys'

interface StoredSealed {
  iv: FirestoreBytes
  ct: FirestoreBytes
}

interface StoredHeader {
  v: 1
  kdf: KdfParams
  passwordSalt: FirestoreBytes
  wrappedByPassword: StoredSealed
  recoverySalt: FirestoreBytes
  wrappedByRecovery: StoredSealed
  keyCheck?: StoredSealed
}

const toStoredBytes = (bytes: Bytes) => FirestoreBytes.fromUint8Array(bytes)
const fromStoredBytes = (bytes: FirestoreBytes): Bytes => new Uint8Array(bytes.toUint8Array())
const toStoredSealed = (sealed: Sealed): StoredSealed => ({ iv: toStoredBytes(sealed.iv), ct: toStoredBytes(sealed.ct) })
const fromStoredSealed = (sealed: StoredSealed): Sealed => ({ iv: fromStoredBytes(sealed.iv), ct: fromStoredBytes(sealed.ct) })

function toStored(header: CryptoHeader): StoredHeader {
  return {
    v: header.v,
    kdf: header.kdf,
    passwordSalt: toStoredBytes(header.passwordSalt),
    wrappedByPassword: toStoredSealed(header.wrappedByPassword),
    recoverySalt: toStoredBytes(header.recoverySalt),
    wrappedByRecovery: toStoredSealed(header.wrappedByRecovery),
    ...(header.keyCheck ? { keyCheck: toStoredSealed(header.keyCheck) } : {}),
  }
}

function fromStored(stored: StoredHeader): CryptoHeader {
  return {
    v: stored.v,
    kdf: stored.kdf,
    passwordSalt: fromStoredBytes(stored.passwordSalt),
    wrappedByPassword: fromStoredSealed(stored.wrappedByPassword),
    recoverySalt: fromStoredBytes(stored.recoverySalt),
    wrappedByRecovery: fromStoredSealed(stored.wrappedByRecovery),
    ...(stored.keyCheck ? { keyCheck: fromStoredSealed(stored.keyCheck) } : {}),
  }
}

// crypto がまだなければ null（初めての設定の画面を出す）
export function subscribeCryptoHeader(
  db: Firestore,
  uid: string,
  onChange: (header: CryptoHeader | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      const stored = snapshot.get('crypto') as StoredHeader | undefined
      onChange(stored ? fromStored(stored) : null)
    },
    onError,
  )
}

// 別の端末で同時に初めての設定をしても、先に保存した方だけを使う。後の方は false を返す
export async function createCryptoHeader(db: Firestore, uid: string, header: CryptoHeader): Promise<boolean> {
  const ref = doc(db, 'users', uid)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (snapshot.get('crypto')) return false
    transaction.set(ref, { createdAt: serverTimestamp(), crypto: toStored(header) })
    return true
  })
}

export async function updateCryptoHeader(db: Firestore, uid: string, header: CryptoHeader): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { crypto: toStored(header) })
}
