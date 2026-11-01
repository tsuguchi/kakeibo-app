import { FirebaseError } from 'firebase/app'
import { sendEmailVerification, type User } from 'firebase/auth'
import { useState } from 'react'
import { useAuth } from '../auth/context'
import { logout } from '../auth/logout'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Layout } from '../components/Layout'

// メールアドレスを確認するまで、家計のデータは使えない（F-03）
export function VerifyEmailPage({ user }: { user: User }) {
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (caught) {
      console.error(caught)
      setError(
        caught instanceof FirebaseError && caught.code === 'auth/too-many-requests'
          ? '送った回数が多すぎます。しばらく待ってから、もう一度お試しください。'
          : 'うまくいきませんでした。時間をおいてもう一度お試しください。',
      )
    } finally {
      setBusy(false)
    }
  }

  const checkVerified = () => run(async () => {
    await refresh()
    if (!user.emailVerified) setMessage('まだ確認が済んでいません。メールのリンクを開いてから、もう一度押してください。')
  })

  const resend = () => run(async () => {
    await sendEmailVerification(user)
    setMessage('確認メールをもう一度送りました。')
  })

  return (
    <Layout
      title="メールアドレスを確認してください"
      headerEnd={<Button type="button" variant="text" size="sm" onClick={logout}>ログアウト</Button>}
    >
      <p>
        {user.email} に確認メールを送りました。メールのリンクを開いてから、下の「確認が済んだ」を押してください。
        メールが届かないときは、迷惑メールのフォルダも確かめてください。
      </p>
      {message && <p role="status">{message}</p>}
      {error && <ErrorText role="alert">{error}</ErrorText>}
      <div className="flex flex-col gap-3 desktop:flex-row">
        <Button type="button" variant="solid-fill" size="lg" aria-disabled={busy} onClick={checkVerified}>確認が済んだ</Button>
        <Button type="button" variant="outline" size="lg" aria-disabled={busy} onClick={resend}>確認メールをもう一度送る</Button>
      </div>
    </Layout>
  )
}
