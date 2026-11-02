import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type TokenOptions,
} from '@firebase/rules-unit-testing'
import { Bytes, deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest'

// alice: 本人 / mallory: ほかの利用者
let env: RulesTestEnvironment

const GOOGLE: TokenOptions = { firebase: { sign_in_provider: 'google.com' } }
const PASSWORD_UNVERIFIED: TokenOptions = { email_verified: false, firebase: { sign_in_provider: 'password' } }
const PASSWORD_VERIFIED: TokenOptions = { email_verified: true, firebase: { sign_in_provider: 'password' } }

function dbAs(uid: string | null, token: TokenOptions = GOOGLE): Firestore {
  const context = uid ? env.authenticatedContext(uid, token) : env.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

const bytes = (length: number) => Bytes.fromUint8Array(new Uint8Array(length).fill(1))
const sealed = () => ({ iv: bytes(12), ct: bytes(48) })
const envelope = (ctLength = 64) => ({ v: 1, iv: bytes(12), ct: bytes(ctLength) })

function cryptoHeader() {
  return {
    v: 1,
    kdf: { name: 'argon2id', m: 19456, t: 2, p: 1 },
    passwordSalt: bytes(16),
    wrappedByPassword: sealed(),
    recoverySalt: bytes(16),
    wrappedByRecovery: sealed(),
  }
}

function transaction(overrides: Record<string, unknown> = {}) {
  return { month: '2026-11', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), enc: envelope(), ...overrides }
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kakeibo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

async function seedUser() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore
    await setDoc(doc(db, 'users/alice'), { createdAt: Timestamp.now(), crypto: cryptoHeader() })
    await setDoc(doc(db, 'users/alice/transactions/t1'), { ...transaction(), createdAt: Timestamp.now(), updatedAt: Timestamp.now() })
  })
}

describe('本人だけが読み書きできる', () => {
  test('本人は読める', async () => {
    await seedUser()
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'users/alice')))
    await assertSucceeds(getDoc(doc(dbAs('alice'), 'users/alice/transactions/t1')))
  })

  test('ほかの利用者は読めない・書けない・消せない', async () => {
    await seedUser()
    const db = dbAs('mallory')
    await assertFails(getDoc(doc(db, 'users/alice')))
    await assertFails(getDoc(doc(db, 'users/alice/transactions/t1')))
    await assertFails(setDoc(doc(db, 'users/alice/transactions/t2'), transaction()))
    await assertFails(deleteDoc(doc(db, 'users/alice/transactions/t1')))
    await assertFails(updateDoc(doc(db, 'users/alice'), { crypto: cryptoHeader() }))
  })

  test('ログインしていなければ読めない', async () => {
    await seedUser()
    await assertFails(getDoc(doc(dbAs(null), 'users/alice')))
  })
})

describe('メールアドレスの確認（F-03）', () => {
  test('メールアドレスで登録して確認前なら、本人でも読めない', async () => {
    await seedUser()
    await assertFails(getDoc(doc(dbAs('alice', PASSWORD_UNVERIFIED), 'users/alice')))
  })

  test('確認が済めば読める', async () => {
    await seedUser()
    await assertSucceeds(getDoc(doc(dbAs('alice', PASSWORD_VERIFIED), 'users/alice')))
  })

  test('GitHub でログインした人は、メールアドレスの確認の状態にかかわらず読める', async () => {
    await seedUser()
    const token: TokenOptions = { email_verified: false, firebase: { sign_in_provider: 'github.com' } }
    await assertSucceeds(getDoc(doc(dbAs('alice', token), 'users/alice')))
  })
})

describe('users/{uid}', () => {
  test('初めての設定で crypto を作れる', async () => {
    await assertSucceeds(setDoc(doc(dbAs('alice'), 'users/alice'), { createdAt: serverTimestamp(), crypto: cryptoHeader() }))
  })

  test('決められていないフィールドは作れない', async () => {
    await assertFails(setDoc(doc(dbAs('alice'), 'users/alice'), {
      createdAt: serverTimestamp(),
      crypto: cryptoHeader(),
      email: 'alice@example.com',
    }))
  })

  test('鍵の情報の形が違えば作れない', async () => {
    const db = dbAs('alice')
    const header = cryptoHeader()
    await assertFails(setDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp(), crypto: { ...header, kdf: { ...header.kdf, name: 'pbkdf2' } } }))
    await assertFails(setDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp(), crypto: { ...header, wrappedByPassword: { iv: bytes(8), ct: bytes(48) } } }))
    await assertFails(setDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp(), crypto: { ...header, passwordSalt: 'salt' } }))
  })

  test('鍵の確かめの値（keyCheck）は、あってもなくてもよいが、形は確かめる', async () => {
    const db = dbAs('alice')
    await assertSucceeds(setDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp(), crypto: { ...cryptoHeader(), keyCheck: sealed() } }))
    await env.clearFirestore()
    await assertFails(setDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp(), crypto: { ...cryptoHeader(), keyCheck: 'abc' } }))
  })

  test('暗号化パスワードの変更で crypto だけを書き換えられる', async () => {
    await seedUser()
    const db = dbAs('alice')
    await assertSucceeds(updateDoc(doc(db, 'users/alice'), { crypto: cryptoHeader() }))
    await assertFails(updateDoc(doc(db, 'users/alice'), { createdAt: serverTimestamp() }))
  })
})

describe('暗号化した中身', () => {
  test('meta は決められた名前だけ作れる', async () => {
    const db = dbAs('alice')
    await assertSucceeds(setDoc(doc(db, 'users/alice/meta/categories'), { enc: envelope() }))
    await assertFails(setDoc(doc(db, 'users/alice/meta/other'), { enc: envelope() }))
  })

  test('暗号化していない値は書き込めない', async () => {
    const db = dbAs('alice')
    await assertFails(setDoc(doc(db, 'users/alice/meta/categories'), { enc: envelope(), items: ['食費'] }))
    await assertFails(setDoc(doc(db, 'users/alice/meta/categories'), { enc: { v: 1, iv: bytes(12), ct: 'plain text' } }))
    await assertFails(setDoc(doc(db, 'users/alice/transactions/t2'), transaction({ amount: 1000 })))
  })

  test('100KB を超える暗号文は書き込めない', async () => {
    await assertFails(setDoc(doc(dbAs('alice'), 'users/alice/meta/categories'), { enc: envelope(100 * 1024 + 1) }))
  })

  test('summaries のドキュメント ID は年月の形', async () => {
    const db = dbAs('alice')
    await assertSucceeds(setDoc(doc(db, 'users/alice/summaries/2026-11'), { enc: envelope() }))
    await assertFails(setDoc(doc(db, 'users/alice/summaries/2026-13'), { enc: envelope() }))
  })

  test('transactions の month は年月の形', async () => {
    const db = dbAs('alice')
    await assertSucceeds(setDoc(doc(db, 'users/alice/transactions/t2'), transaction()))
    await assertFails(setDoc(doc(db, 'users/alice/transactions/t3'), transaction({ month: '2026/11' })))
  })

  test('transactions の更新では createdAt を変えられない', async () => {
    await seedUser()
    const db = dbAs('alice')
    await assertSucceeds(updateDoc(doc(db, 'users/alice/transactions/t1'), { enc: envelope(), updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'users/alice/transactions/t1'), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  test('本人は削除できる（アカウントの削除 F-07）', async () => {
    await seedUser()
    const db = dbAs('alice')
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/transactions/t1')))
    await assertSucceeds(deleteDoc(doc(db, 'users/alice')))
  })
})
