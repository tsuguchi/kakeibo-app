import { FirebaseError } from 'firebase/app'
import { deleteUser } from 'firebase/auth'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { markAccountDeleted } from '../auth/accountDeleted'
import { logout } from '../auth/logout'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Layout } from '../components/Layout'
import { PageMessage } from '../components/PageMessage'
import { clearDeviceKeys, deleteDeviceKeys, loadDeviceKeys, saveDeviceKeys } from '../lib/crypto/deviceStore'
import { matchesHeader, type CryptoHeader, type DataKeys } from '../lib/crypto/keys'
import { deleteUserData } from '../lib/data/deleteData'
import { auth, db } from '../lib/firebase'
import { subscribeCryptoHeader } from '../lib/userCrypto'
import { KeyContext, type DeletionMode } from './context'

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((byte, index) => byte === b[index])
}

// 同じ鍵の設定か。復旧キー用のソルトは鍵を作るときに 1 回だけ決まり、暗号化パスワードを変えても変わらない。
// 最初からやり直すと新しく作り直されるので、違っていれば別の鍵
function sameKeyCheck(a: CryptoHeader, b: CryptoHeader): boolean {
  return a === b || sameBytes(a.recoverySalt, b.recoverySalt)
}

interface Deletion {
  mode: DeletionMode
  deleted: number
  error: string | null
}

// ログインした利用者の鍵の状態を持つ。App から uid ごとに key を付けて使い、利用者が替わったら作り直す
export function KeyProvider({ uid, children }: { uid: string, children: ReactNode }) {
  const [header, setHeader] = useState<CryptoHeader | null | undefined>(undefined)
  const [keys, setKeys] = useState<DataKeys | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [deletion, setDeletion] = useState<Deletion | null>(null)

  // 鍵の情報がない（初めての設定の画面）のに端末に鍵が残っていれば、前の設定のものなので消す。
  // 設定の途中で古い鍵の確かめが動いて、新しい鍵とぶつからないようにするため
  const headerRef = useRef<CryptoHeader | null | undefined>(undefined)
  useEffect(() => subscribeCryptoHeader(db, uid, (next) => {
    headerRef.current = next
    setHeader(next)
    if (next === null) {
      setKeys((current) => (current ? null : current))
      void deleteDeviceKeys(uid)
    }
  }, setError), [uid])

  useEffect(() => {
    let cancelled = false
    loadDeviceKeys(uid).then((loaded) => {
      if (cancelled) return
      if (headerRef.current === null && loaded) {
        void deleteDeviceKeys(uid)
        setKeys((current) => current ?? null)
        return
      }
      setKeys((current) => current ?? loaded)
    })
    return () => {
      cancelled = true
    }
  }, [uid])

  // 端末に覚えた鍵が、今の設定の鍵と違えば使わずに消す（別の端末で最初からやり直したときなど）。
  // 消したあとは、暗号化パスワードを入力する画面になる
  // 鍵の情報（header）が変わったときも確かめ直す。別の端末で最初からやり直すと、鍵は同じまま header だけが変わるため
  const [checked, setChecked] = useState<{ keys: DataKeys, header: CryptoHeader } | null>(null)
  // 暗号化パスワードの変更では確かめる値（keyCheck）は変わらないので、確かめ直さない（画面を閉じずに済む）
  const isChecked = !!header && !!keys && checked?.keys === keys && sameKeyCheck(checked.header, header)
  useEffect(() => {
    if (!header || !keys || isChecked) return
    let cancelled = false
    matchesHeader(keys, header).then(async (matches) => {
      if (cancelled) return
      if (matches) {
        setChecked({ keys, header })
        return
      }
      // 確かめている間に新しい鍵に替わっていれば（初めての設定を終えた直後など）、そちらは消さない
      setKeys((current) => (current === keys ? null : current))
      await deleteDeviceKeys(uid)
    })
    return () => {
      cancelled = true
    }
  }, [header, keys, isChecked, uid])

  async function unlock(nextKeys: DataKeys, remember: boolean) {
    if (remember) await saveDeviceKeys(uid, nextKeys)
    setKeys(nextKeys)
  }

  // データの削除（F-07）と、最初からやり直す（F-85）。本人確認は呼ぶ側で済ませておく。
  // 記録の画面を先に閉じてから消す。開いたままだと、消えた分類などを画面が作り直してしまうため
  async function startDeletion(mode: DeletionMode) {
    setDeletion({ mode, deleted: 0, error: null })
    try {
      await deleteUserData(db, uid, (deleted) => setDeletion((current) => current && { ...current, deleted }))
      await clearDeviceKeys()
      if (mode === 'account') {
        markAccountDeleted()
        // ログインのアカウントを消すと、自動でログアウトしてログイン画面に戻る
        await deleteUser(auth.currentUser!)
        return
      }
      setKeys(null)
      setDeletion(null)
    } catch (caught) {
      console.error(caught)
      setDeletion((current) => current && {
        ...current,
        error: caught instanceof FirebaseError && caught.code === 'auth/requires-recent-login'
          ? '本人確認から時間がたったため、アカウントを削除できませんでした。家計のデータは削除済みです。ログアウトしてログインし直し、もう一度アカウントの削除を行ってください。'
          : mode === 'account'
            ? 'アカウントを削除できませんでした。インターネットの接続を確かめて、もう一度お試しください。'
            : 'データを削除できませんでした。インターネットの接続を確かめて、もう一度お試しください。',
      })
    }
  }

  if (error) {
    console.error(error)
    return <PageMessage>データを読み込めませんでした。時間をおいて、ページを読み込み直してください。</PageMessage>
  }

  if (deletion) {
    return (
      <Layout title={deletion.mode === 'account' ? 'アカウントを削除しています' : 'データを削除しています'}>
        {!deletion.error && <p role="status">削除しています…（{deletion.deleted} 件）。この画面を閉じないでください。</p>}
        {deletion.error && (
          <>
            <ErrorText role="alert">{deletion.error}</ErrorText>
            <p>途中まで削除した分は戻りません。もう一度試すと、残りを削除します。</p>
            {/* やり直しでは本人確認をし直さない。確認から時間がたって失敗したときは、ログインし直してから削除の画面を開き直す */}
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="solid-fill" size="lg" onClick={() => startDeletion(deletion.mode)}>もう一度試す</Button>
              <Button type="button" variant="outline" size="lg" onClick={logout}>ログアウトする</Button>
            </div>
          </>
        )}
      </Layout>
    )
  }

  if (header === undefined || keys === undefined) return <PageMessage>読み込み中…</PageMessage>
  // 鍵を確かめ終えるまでは、記録の画面を出さない
  if (header && keys && !isChecked) return <PageMessage>読み込み中…</PageMessage>

  // まだ設定していない（または設定を消した）のに鍵が残っていれば、使わない
  return (
    <KeyContext value={{ uid, header, keys: header ? keys : null, unlock, startDeletion }}>
      {children}
    </KeyContext>
  )
}
