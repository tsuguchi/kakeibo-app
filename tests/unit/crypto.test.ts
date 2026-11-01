import { describe, expect, test } from 'vitest'
import { decodeCrockford, encodeCrockford, randomBytes } from '../../src/lib/crypto/encoding'
import { DecryptError, decryptJson, encryptJson, recurringTransactionId } from '../../src/lib/crypto/envelope'
import {
  changePassword,
  createKeys,
  resetPasswordWithRecovery,
  unlockWithPassword,
  WrongSecretError,
  type KdfParams,
} from '../../src/lib/crypto/keys'

// テストを速くするため、Argon2id の設定を軽くする（本番の値は DEFAULT_KDF）
const FAST_KDF: KdfParams = { name: 'argon2id', m: 256, t: 1, p: 1 }
const PATH = 'users/u1/transactions/t1'
const RECORD = { type: 'expense', date: '2026-11-27', amount: 85000, memo: '家賃' }

describe('Crockford の Base32', () => {
  test('変換して元に戻せる', () => {
    const bytes = randomBytes(20)
    const code = encodeCrockford(bytes)
    expect(code).toHaveLength(32)
    expect(decodeCrockford(code)).toEqual(bytes)
  })

  test('小文字・区切り・読み間違えやすい文字を吸収する', () => {
    const code = encodeCrockford(randomBytes(20))
    const messy = code.toLowerCase().match(/.{1,4}/g)!.join(' - ').replace(/0/g, 'o').replace(/1/g, 'l')
    expect(decodeCrockford(messy)).toEqual(decodeCrockford(code))
  })

  test('使えない文字があれば null', () => {
    expect(decodeCrockford('ABC!')).toBeNull()
  })
})

describe('鍵の作成と取り出し', () => {
  test('暗号化パスワードで開いた鍵で、作ったときの鍵の暗号文を復号できる', async () => {
    const created = await createKeys('correct horse battery', FAST_KDF)
    const envelope = await encryptJson(created.keys, PATH, RECORD)
    const keys = await unlockWithPassword(created.header, 'correct horse battery')
    expect(await decryptJson(keys, PATH, envelope)).toEqual(RECORD)
  })

  test('全角と半角の違いは同じ暗号化パスワードとして扱う', async () => {
    const created = await createKeys('password１２３', FAST_KDF)
    await expect(unlockWithPassword(created.header, 'password123')).resolves.toBeDefined()
  })

  test('暗号化パスワードが違えば WrongSecretError', async () => {
    const created = await createKeys('correct horse battery', FAST_KDF)
    await expect(unlockWithPassword(created.header, 'wrong password!')).rejects.toBeInstanceOf(WrongSecretError)
  })

  test('復旧キーは 4 文字ずつ区切った 32 文字', async () => {
    const created = await createKeys('correct horse battery', FAST_KDF)
    expect(created.recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  test('鍵を作るたびに、マスターキーもソルトも変わる', async () => {
    const a = await createKeys('same password!!', FAST_KDF)
    const b = await createKeys('same password!!', FAST_KDF)
    expect(a.header.passwordSalt).not.toEqual(b.header.passwordSalt)
    const envelope = await encryptJson(a.keys, PATH, RECORD)
    await expect(decryptJson(b.keys, PATH, envelope)).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('暗号化パスワードの変更（F-83）', () => {
  test('変更後は新しい暗号化パスワードで開け、前の記録もそのまま復号できる', async () => {
    const created = await createKeys('old password!!', FAST_KDF)
    const envelope = await encryptJson(created.keys, PATH, RECORD)
    const header = await changePassword(created.header, 'old password!!', 'new password!!', FAST_KDF)

    await expect(unlockWithPassword(header, 'old password!!')).rejects.toBeInstanceOf(WrongSecretError)
    const keys = await unlockWithPassword(header, 'new password!!')
    expect(await decryptJson(keys, PATH, envelope)).toEqual(RECORD)
    // 復旧キーで包んだ分は変わらない
    expect(header.wrappedByRecovery).toEqual(created.header.wrappedByRecovery)
  })

  test('今の暗号化パスワードが違えば変更できない', async () => {
    const created = await createKeys('old password!!', FAST_KDF)
    await expect(changePassword(created.header, 'wrong password', 'new password!!', FAST_KDF))
      .rejects.toBeInstanceOf(WrongSecretError)
  })
})

describe('復旧キーでの再設定（F-84）', () => {
  test('復旧キーで開いて新しい暗号化パスワードを決められ、前の記録も復号できる', async () => {
    const created = await createKeys('forgotten password', FAST_KDF)
    const envelope = await encryptJson(created.keys, PATH, RECORD)
    const typed = created.recoveryCode.toLowerCase().replace(/-/g, ' ')
    const reset = await resetPasswordWithRecovery(created.header, typed, 'brand new password', FAST_KDF)

    expect(await decryptJson(reset.keys, PATH, envelope)).toEqual(RECORD)
    const keys = await unlockWithPassword(reset.header, 'brand new password')
    expect(await decryptJson(keys, PATH, envelope)).toEqual(RECORD)
  })

  test('復旧キーが違えば WrongSecretError', async () => {
    const created = await createKeys('forgotten password', FAST_KDF)
    const other = await createKeys('forgotten password', FAST_KDF)
    await expect(resetPasswordWithRecovery(created.header, other.recoveryCode, 'brand new password', FAST_KDF))
      .rejects.toBeInstanceOf(WrongSecretError)
    await expect(resetPasswordWithRecovery(created.header, 'ABCD', 'brand new password', FAST_KDF))
      .rejects.toBeInstanceOf(WrongSecretError)
  })
})

describe('ドキュメントの暗号化', () => {
  test('暗号文を別のドキュメントに付け替えると復号できない', async () => {
    const { keys } = await createKeys('correct horse battery', FAST_KDF)
    const envelope = await encryptJson(keys, PATH, RECORD)
    await expect(decryptJson(keys, 'users/u1/transactions/t2', envelope)).rejects.toBeInstanceOf(DecryptError)
  })

  test('暗号文が 1 バイトでも書き換えられると復号できない', async () => {
    const { keys } = await createKeys('correct horse battery', FAST_KDF)
    const envelope = await encryptJson(keys, PATH, RECORD)
    const tampered = new Uint8Array(envelope.ct)
    tampered[0] ^= 1
    await expect(decryptJson(keys, PATH, { ...envelope, ct: tampered })).rejects.toBeInstanceOf(DecryptError)
  })

  test('同じ中身でも暗号化するたびに暗号文が変わる', async () => {
    const { keys } = await createKeys('correct horse battery', FAST_KDF)
    const a = await encryptJson(keys, PATH, RECORD)
    const b = await encryptJson(keys, PATH, RECORD)
    expect(a.iv).not.toEqual(b.iv)
    expect(a.ct).not.toEqual(b.ct)
  })
})

describe('自動記録の記録 ID（F-62）', () => {
  test('同じ設定・同じ月なら同じ ID、月が違えば違う ID', async () => {
    const created = await createKeys('correct horse battery', FAST_KDF)
    const again = await unlockWithPassword(created.header, 'correct horse battery')
    const id = await recurringTransactionId(created.keys, 'r1', '2026-11')
    expect(await recurringTransactionId(again, 'r1', '2026-11')).toBe(id)
    expect(await recurringTransactionId(created.keys, 'r1', '2026-12')).not.toBe(id)
    expect(id).toMatch(/^[A-Za-z0-9_-]{27}$/)
  })
})
