import { useState, type FormEvent } from 'react'
import { logout } from '../auth/logout'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Field } from '../components/Field'
import { Layout } from '../components/Layout'
import { changePassword, WrongSecretError, type CryptoHeader } from '../lib/crypto/keys'
import { db } from '../lib/firebase'
import { updateCryptoHeader } from '../lib/userCrypto'
import { useKeys } from '../keys/context'
import { MIN_CRYPTO_PASSWORD, validateNewCryptoPassword } from './crypto/passwordRules'

// 記録の画面ができるまでの仮のホーム。暗号化パスワードの変更（F-83）とログアウトだけを置く
export function HomePage({ header }: { header: CryptoHeader }) {
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
    <Layout
      title="ホーム"
      headerEnd={<Button type="button" variant="text" size="sm" onClick={logout}>ログアウト</Button>}
    >
      <p>記録を開きました。記録の画面は、これから作ります。</p>

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
    </Layout>
  )
}
