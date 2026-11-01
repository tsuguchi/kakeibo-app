import { useEffect, useState, type ReactNode } from 'react'
import { PageMessage } from '../components/PageMessage'
import { loadDeviceKeys, saveDeviceKeys } from '../lib/crypto/deviceStore'
import type { CryptoHeader, DataKeys } from '../lib/crypto/keys'
import { db } from '../lib/firebase'
import { subscribeCryptoHeader } from '../lib/userCrypto'
import { KeyContext } from './context'

// ログインした利用者の鍵の状態を持つ。App から uid ごとに key を付けて使い、利用者が替わったら作り直す
export function KeyProvider({ uid, children }: { uid: string, children: ReactNode }) {
  const [header, setHeader] = useState<CryptoHeader | null | undefined>(undefined)
  const [keys, setKeys] = useState<DataKeys | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => subscribeCryptoHeader(db, uid, setHeader, setError), [uid])

  useEffect(() => {
    let cancelled = false
    loadDeviceKeys(uid).then((loaded) => {
      if (!cancelled) setKeys((current) => current ?? loaded)
    })
    return () => {
      cancelled = true
    }
  }, [uid])

  async function unlock(nextKeys: DataKeys, remember: boolean) {
    if (remember) await saveDeviceKeys(uid, nextKeys)
    setKeys(nextKeys)
  }

  if (error) {
    console.error(error)
    return <PageMessage>データを読み込めませんでした。時間をおいて、ページを読み込み直してください。</PageMessage>
  }
  if (header === undefined || keys === undefined) return <PageMessage>読み込み中…</PageMessage>

  // まだ設定していない（または設定を消した）のに鍵が残っていれば、使わない
  return (
    <KeyContext value={{ uid, header, keys: header ? keys : null, unlock }}>
      {children}
    </KeyContext>
  )
}
