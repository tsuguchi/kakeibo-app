import { useState, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { logout } from '../auth/logout'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Field } from '../components/Field'
import { Layout, MainNav } from '../components/Layout'
import { changePassword, WrongSecretError, type CryptoHeader } from '../lib/crypto/keys'
import { db } from '../lib/firebase'
import { updateCryptoHeader } from '../lib/userCrypto'
import { useKeys } from '../keys/context'
import { MIN_CRYPTO_PASSWORD, validateNewCryptoPassword } from './crypto/passwordRules'

// 設定。暗号化パスワードの変更（F-83）とログアウト
export function SettingsPage({ header }: { header: CryptoHeader }) {
  const { uid } = useKeys()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const invalid = validateNewCryptoPassword(next, confirmation)
    setError(invalid)
    if (invalid) return
    setBusy(true)
    try {
      await updateCryptoHeader(db, uid, await changePassword(header, current, next))
      setCurrent('')
      setNext('')
      setConfirmation('')
      setMessage('暗号化パスワードを変更しました。ほかの端末でも、次に開くときから新しい暗号化パスワードを使います。')
    } catch (caught) {
      if (caught instanceof WrongSecretError) {
        setError('今の暗号化パスワードが違います。')
      } else {
        console.error(caught)
        setError('変更できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="設定" headerEnd={<MainNav />}>
      <section aria-labelledby="categories-heading" className="flex flex-col gap-4">
        <h2 id="categories-heading" className="text-std-20B-150">分類</h2>
        <p>記録のときに選ぶ分類の追加・名前の変更・並べ替え・非表示ができます。</p>
        <div>
          <Button asChild variant="outline" size="lg">
            <RouterLink to="/settings/categories">分類を編集する</RouterLink>
          </Button>
        </div>
      </section>

      <section aria-labelledby="recurring-heading" className="flex flex-col gap-4">
        <h2 id="recurring-heading" className="text-std-20B-150">毎月の自動記録</h2>
        <p>家賃やサブスクなど、毎月同じ記録を自動で付けます。</p>
        <div>
          <Button asChild variant="outline" size="lg">
            <RouterLink to="/settings/recurring">自動記録を設定する</RouterLink>
          </Button>
        </div>
      </section>

      <section aria-labelledby="csv-heading" className="flex flex-col gap-4">
        <h2 id="csv-heading" className="text-std-20B-150">CSV の書き出し・取り込み</h2>
        <p>記録を CSV ファイルに保存したり、銀行やカード会社の明細を取り込んだりできます。</p>
        <div>
          <Button asChild variant="outline" size="lg">
            <RouterLink to="/settings/csv">CSV の画面を開く</RouterLink>
          </Button>
        </div>
      </section>


      <section aria-labelledby="change-heading" className="flex flex-col gap-4">
        <h2 id="change-heading" className="text-std-20B-150">暗号化パスワードの変更</h2>
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <Field
            label="今の暗号化パスワード"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <Field
            label="新しい暗号化パスワード"
            type="password"
            autoComplete="new-password"
            support={`${MIN_CRYPTO_PASSWORD} 文字以上。`}
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <Field
            label="新しい暗号化パスワード（確認のためもう一度）"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error && <ErrorText role="alert">{error}</ErrorText>}
          {message && <p role="status">{message}</p>}
          <div>
            <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
              {busy ? '変更しています…' : '変更する'}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="account-heading" className="flex flex-col gap-4">
        <h2 id="account-heading" className="text-std-20B-150">アカウント</h2>
        <p>ログアウトすると、この端末に覚えた鍵も消えます。次に開くときは、暗号化パスワードを入力します。</p>
        <div>
          <Button type="button" variant="outline" size="lg" onClick={logout}>ログアウト</Button>
        </div>
      </section>
    </Layout>
  )
}
