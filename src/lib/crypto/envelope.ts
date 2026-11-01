// ドキュメントの中身の暗号化（DATA_MODEL.md 2.3）
import { randomBytes, toBase64Url, utf8, type Bytes } from './encoding'
import type { DataKeys } from './keys'

export const ENVELOPE_VERSION = 1

export interface Envelope {
  v: number
  iv: Bytes
  ct: Bytes
}

// 復号に失敗したとき（鍵が違う・暗号文が壊れている・別のドキュメントに付け替えられた）
export class DecryptError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`データを復号できませんでした（${path}）`)
    this.name = 'DecryptError'
    this.path = path
  }
}

// 暗号文を別のドキュメントに付け替えられたら気づけるよう、ドキュメントのパスと形式の版を追加認証データに入れる
function aad(path: string, v: number): Bytes {
  return utf8(`kakeibo/doc/v${v}/${path}`)
}

export async function encryptJson(keys: DataKeys, path: string, value: unknown): Promise<Envelope> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(path, ENVELOPE_VERSION) },
    keys.encKey,
    utf8(JSON.stringify(value)),
  )
  return { v: ENVELOPE_VERSION, iv, ct: new Uint8Array(ct) }
}

export async function decryptJson<T>(keys: DataKeys, path: string, envelope: Envelope): Promise<T> {
  if (envelope.v !== ENVELOPE_VERSION) throw new DecryptError(path)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: envelope.iv, additionalData: aad(path, envelope.v) },
      keys.encKey,
      envelope.ct,
    )
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch {
    throw new DecryptError(path)
  }
}

// 自動記録の記録 ID（DATA_MODEL.md 3 章）。同じ設定・同じ月なら同じ ID になり、ID から中身は分からない
export async function recurringTransactionId(keys: DataKeys, recurringId: string, month: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', keys.idKey, utf8(`recurring/${recurringId}/${month}`))
  return toBase64Url(new Uint8Array(mac).slice(0, 20))
}
