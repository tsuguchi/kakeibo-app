// 鍵の構成（DATA_MODEL.md 2.2）
//
// 暗号化パスワード ─Argon2id─▶ パスワード鍵 ─┐
//                                             ├─ 包む ─▶ マスターキー ─HKDF─▶ 暗号化鍵・ID 鍵
// 復旧キー ───────HKDF──────▶ 復旧鍵 ───────┘
//
// サーバーに保存するのは、包んだマスターキーとソルトと設定の値（CryptoHeader）だけ。
// マスターキーそのものは、この中の関数の外に出さない
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { decodeCrockford, encodeCrockford, groupBy4, randomBytes, utf8, type Bytes } from './encoding'

export interface KdfParams {
  name: 'argon2id'
  m: number
  t: number
  p: number
}

// OWASP Password Storage Cheat Sheet の Argon2id の最低限の設定の 1 つ（2026-11-02 に確認）
export const DEFAULT_KDF: KdfParams = { name: 'argon2id', m: 19456, t: 2, p: 1 }

export interface Sealed {
  iv: Bytes
  ct: Bytes
}

export interface CryptoHeader {
  v: 1
  kdf: KdfParams
  passwordSalt: Bytes
  wrappedByPassword: Sealed
  recoverySalt: Bytes
  wrappedByRecovery: Sealed
  // 暗号化鍵で決まった値を暗号化したもの。端末に覚えた鍵が今の鍵と同じかを確かめる（別の端末で最初からやり直したときなど）。
  // 2026-11 より前に作った設定にはない
  keyCheck?: Sealed
}

// データの暗号化と、自動記録の記録 ID に使う鍵。どちらも取り出し不可（non-extractable）
export interface DataKeys {
  encKey: CryptoKey
  idKey: CryptoKey
}

// 暗号化パスワードか復旧キーが違うとき
export class WrongSecretError extends Error {
  constructor() {
    super('暗号化パスワードか復旧キーが違います')
    this.name = 'WrongSecretError'
  }
}

const MASTER_KEY_BYTES = 32
const RECOVERY_KEY_BYTES = 20 // 160 ビット。Crockford の Base32 で 32 文字になる
const WRAP_AAD = utf8('kakeibo/master-key/v1')

// 全角・半角などのゆれで開けなくならないよう、暗号化パスワードは NFKC で正規化してから使う
export function normalizePassword(password: string): string {
  return password.normalize('NFKC')
}

async function passwordKey(password: string, salt: Bytes, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2idAsync(utf8(normalizePassword(password)), salt, {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: 32,
    asyncTick: 10, // 計算の途中で画面の処理に順番を譲り、画面が固まらないようにする
  })
  const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
  raw.fill(0)
  return key
}

async function recoveryKey(recovery: Bytes, salt: Bytes): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', recovery, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('kakeibo/recovery-key/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function wrap(master: Bytes, kek: CryptoKey): Promise<Sealed> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: WRAP_AAD }, kek, master))
  return { iv, ct }
}

async function unwrap(sealed: Sealed, kek: CryptoKey): Promise<Bytes> {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: WRAP_AAD }, kek, sealed.ct),
    )
  } catch {
    // AES-GCM は鍵が違うと取り出しに失敗する。これで暗号化パスワードが合っているかを確かめる
    throw new WrongSecretError()
  }
}

async function deriveDataKeys(master: Bytes): Promise<DataKeys> {
  const base = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey'])
  const salt = new Uint8Array(32)
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('kakeibo/enc-key/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const idKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8('kakeibo/id-key/v1') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
  return { encKey, idKey }
}

async function sealForPassword(master: Bytes, password: string, kdf: KdfParams) {
  const passwordSalt = randomBytes(16)
  const wrappedByPassword = await wrap(master, await passwordKey(password, passwordSalt, kdf))
  return { passwordSalt, wrappedByPassword }
}

export interface CreatedKeys {
  header: CryptoHeader
  keys: DataKeys
  // 4 文字ずつ区切った復旧キー。画面に 1 度だけ表示し、どこにも保存しない
  recoveryCode: string
}

// 初めての設定（F-80）
export async function createKeys(password: string, kdf: KdfParams = DEFAULT_KDF): Promise<CreatedKeys> {
  const master = randomBytes(MASTER_KEY_BYTES)
  const recovery = randomBytes(RECOVERY_KEY_BYTES)
  const recoverySalt = randomBytes(16)
  try {
    const header: CryptoHeader = {
      v: 1,
      kdf,
      ...(await sealForPassword(master, password, kdf)),
      recoverySalt,
      wrappedByRecovery: await wrap(master, await recoveryKey(recovery, recoverySalt)),
    }
    const keys = await deriveDataKeys(master)
    return { header: { ...header, keyCheck: await makeKeyCheck(keys) }, keys, recoveryCode: groupBy4(encodeCrockford(recovery)) }
  } finally {
    master.fill(0)
    recovery.fill(0)
  }
}

// 暗号化パスワードでデータを開く（F-81）
export async function unlockWithPassword(header: CryptoHeader, password: string): Promise<DataKeys> {
  const master = await unwrap(header.wrappedByPassword, await passwordKey(password, header.passwordSalt, header.kdf))
  try {
    return await deriveDataKeys(master)
  } finally {
    master.fill(0)
  }
}

// 暗号化パスワードの変更（F-83）。マスターキーを包み直すだけで、記録は暗号化し直さない
export async function changePassword(
  header: CryptoHeader,
  currentPassword: string,
  newPassword: string,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<CryptoHeader> {
  const master = await unwrap(header.wrappedByPassword, await passwordKey(currentPassword, header.passwordSalt, header.kdf))
  try {
    return { ...header, kdf, ...(await sealForPassword(master, newPassword, kdf)) }
  } finally {
    master.fill(0)
  }
}

// 復旧キーでデータを開き、新しい暗号化パスワードを決める（F-84）
export async function resetPasswordWithRecovery(
  header: CryptoHeader,
  recoveryCode: string,
  newPassword: string,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<{ header: CryptoHeader, keys: DataKeys }> {
  const recovery = decodeCrockford(recoveryCode)
  if (!recovery || recovery.length !== RECOVERY_KEY_BYTES) throw new WrongSecretError()
  const master = await unwrap(header.wrappedByRecovery, await recoveryKey(recovery, header.recoverySalt))
  try {
    return {
      header: { ...header, kdf, ...(await sealForPassword(master, newPassword, kdf)) },
      keys: await deriveDataKeys(master),
    }
  } finally {
    master.fill(0)
    recovery.fill(0)
  }
}

const KEY_CHECK_AAD = utf8('kakeibo/key-check/v1')
const KEY_CHECK_TEXT = utf8('kakeibo key check')

export async function makeKeyCheck(keys: DataKeys): Promise<Sealed> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: KEY_CHECK_AAD }, keys.encKey, KEY_CHECK_TEXT))
  return { iv, ct }
}

// 鍵が今の設定の鍵と同じなら true。確かめる値がない古い設定では、確かめられないので true
export async function matchesHeader(keys: DataKeys, header: CryptoHeader): Promise<boolean> {
  if (!header.keyCheck) return true
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.keyCheck.iv, additionalData: KEY_CHECK_AAD }, keys.encKey, header.keyCheck.ct)
    return true
  } catch {
    return false
  }
}
