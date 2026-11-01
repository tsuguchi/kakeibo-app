import { useState, type FormEvent } from 'react'
import { logout } from '../../auth/logout'
import { Button } from '../../components/dads/Button'
import { Checkbox } from '../../components/dads/Checkbox'
import { ErrorText } from '../../components/dads/ErrorText'
import { NotificationBanner, NotificationBannerBody } from '../../components/dads/NotificationBanner'
import { Field } from '../../components/Field'
import { Layout } from '../../components/Layout'
import { createKeys, type CreatedKeys } from '../../lib/crypto/keys'
import { db } from '../../lib/firebase'
import { createCryptoHeader } from '../../lib/userCrypto'
import { useKeys } from '../../keys/context'
import { MIN_CRYPTO_PASSWORD, validateNewCryptoPassword } from './passwordRules'

// 初めての設定（F-80）。暗号化パスワードを決め、復旧キーを 1 度だけ表示する。
// 復旧キーを保管したと確かめてから保存するので、途中でやめても何も残らない
export function SetupPage() {
  const { uid, unlock } = useKeys()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [created, setCreated] = useState<CreatedKeys | null>(null)
  const [stored, setStored] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitPassword(event: FormEvent) {
    event.preventDefault()
    const invalid = validateNewCryptoPassword(password, confirmation)
    setError(invalid)
    if (invalid) return
    setBusy(true)
    try {
      setCreated(await createKeys(password))
      setPassword('')
      setConfirmation('')
    } catch (caught) {
      console.error(caught)
      setError('鍵を作れませんでした。ページを読み込み直して、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    if (!created) return
    setBusy(true)
    setError(null)
    try {
      const saved = await createCryptoHeader(db, uid, created.header)
      if (!saved) {
        // 別の端末で先に設定が済んでいた。画面は自動でデータを開く画面に切り替わる
        return
      }
      await unlock(created.keys, remember)
    } catch (caught) {
      console.error(caught)
      setError('保存できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  const headerEnd = <Button type="button" variant="text" size="sm" onClick={logout}>ログアウト</Button>

  if (!created) {
    return (
      <Layout title="暗号化パスワードを決める" headerEnd={headerEnd}>
        <p>
          家計の記録は、ここで決める「暗号化パスワード」で鍵をかけてから保存します。
          ログインのパスワードとは別のものです。運営する側はこのパスワードを知らないので、記録の中身を見ることはできません。
        </p>
        <form className="flex flex-col gap-6" onSubmit={submitPassword} noValidate>
          <Field
            label="暗号化パスワード"
            type="password"
            autoComplete="new-password"
            support={`${MIN_CRYPTO_PASSWORD} 文字以上。ほかのサービスと同じものは使わないでください。`}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Field
            label="暗号化パスワード（確認のためもう一度）"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
            {busy ? '鍵を作っています…' : '次へ'}
          </Button>
        </form>
      </Layout>
    )
  }

  return (
    <Layout title="復旧キーを保管する" headerEnd={headerEnd}>
      <NotificationBanner bannerStyle="standard" type="warning" title="この画面は 1 度しか表示されません" headingLevel="h2">
        <NotificationBannerBody>
          <p>
            暗号化パスワードを忘れたときは、この復旧キーでだけ記録を開けます。
            暗号化パスワードと復旧キーの両方をなくすと、記録は誰にも元に戻せません。
          </p>
          <p>印刷するか紙に書き写して、ほかの人に見られない場所に保管してください。</p>
        </NotificationBannerBody>
      </NotificationBanner>

      <section aria-labelledby="recovery-heading" className="flex flex-col gap-3">
        <h2 id="recovery-heading" className="text-std-20B-150">復旧キー</h2>
        <p className="break-all rounded-8 border border-solid-gray-420 bg-solid-gray-50 p-4 text-mono-17B-150 tracking-wider">
          {created.recoveryCode}
        </p>
        <div>
          <Button type="button" variant="outline" size="md" onClick={() => window.print()}>この画面を印刷する</Button>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <label className="flex items-start gap-2">
          <Checkbox checked={stored} onChange={(event) => setStored(event.target.checked)} />
          <span>復旧キーを保管しました</span>
        </label>
        <label className="flex items-start gap-2">
          <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>
            この端末で覚える（次から暗号化パスワードの入力を省けます。家族などと共用の端末では選ばないでください）
          </span>
        </label>
      </div>

      {error && <ErrorText role="alert">{error}</ErrorText>}
      <Button type="button" variant="solid-fill" size="lg" aria-disabled={!stored || busy} onClick={finish}>
        設定を終えて始める
      </Button>
    </Layout>
  )
}
