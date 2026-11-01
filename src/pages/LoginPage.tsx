import { FirebaseError } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  GithubAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  type AuthCredential,
  type AuthProvider,
  type User,
} from 'firebase/auth'
import { useState, type FormEvent } from 'react'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Field } from '../components/Field'
import { Layout } from '../components/Layout'
import { auth } from '../lib/firebase'

const PROVIDERS = {
  google: { label: 'Google', create: (): AuthProvider => new GoogleAuthProvider(), credentialClass: GoogleAuthProvider },
  github: { label: 'GitHub', create: (): AuthProvider => new GithubAuthProvider(), credentialClass: GithubAuthProvider },
} as const

type ProviderId = keyof typeof PROVIDERS
type Mode = 'login' | 'register' | 'reset'

const MIN_LOGIN_PASSWORD = 8

const MODE_TITLES: Record<Mode, string> = {
  login: 'ログイン',
  register: 'メールアドレスで新しく登録',
  reset: 'パスワードの再設定',
}

function errorMessage(error: FirebaseError, label: string): string | null {
  switch (error.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null
    case 'auth/popup-blocked':
      return 'ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'メールアドレスかパスワードが違います。'
    case 'auth/email-already-in-use':
      return 'このメールアドレスはすでに登録されています。ログインしてください。Google や GitHub で登録した場合は、そのボタンからログインしてください。'
    case 'auth/invalid-email':
      return 'メールアドレスの形が正しくありません。'
    case 'auth/weak-password':
      return `パスワードは ${MIN_LOGIN_PASSWORD} 文字以上にしてください。`
    case 'auth/too-many-requests':
      return '試した回数が多すぎます。しばらく待ってから、もう一度お試しください。'
    case 'auth/network-request-failed':
      return 'インターネットにつながっていないようです。接続を確かめてください。'
    // 以下の 2 つは Firebase の設定の問題で、利用者には直せない。管理者に伝えやすいよう原因を示す
    case 'auth/operation-not-allowed':
      return `${label} でのログインが有効になっていません。管理者に連絡してください（Firebase の Authentication でログイン方法を有効にする必要があります）。`
    case 'auth/unauthorized-domain':
      return 'このサイトからのログインが許可されていません。管理者に連絡してください（Firebase の Authentication の承認済みドメインに追加する必要があります）。'
    default:
      console.error(error)
      // 原因を調べられるよう、エラーコードも表示する
      return `うまくいきませんでした。時間をおいてもう一度お試しください。（${error.code}）`
  }
}

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 同じメールアドレスで別の方法を使ってログインしようとしたときの、つなぎ待ちのログイン情報（F-05）
  const [pendingLink, setPendingLink] = useState<{ credential: AuthCredential, label: string } | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function linkPending(user: User) {
    if (!pendingLink) return
    await linkWithCredential(user, pendingLink.credential)
    setPendingLink(null)
  }

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      if (!(caught instanceof FirebaseError)) throw caught
      setError(errorMessage(caught, label))
    } finally {
      setBusy(false)
    }
  }

  function signInWithProvider(providerId: ProviderId) {
    const provider = PROVIDERS[providerId]
    return run(provider.label, async () => {
      try {
        const result = await signInWithPopup(auth, provider.create())
        await linkPending(result.user)
      } catch (caught) {
        if (caught instanceof FirebaseError && caught.code === 'auth/account-exists-with-different-credential') {
          const credential = provider.credentialClass.credentialFromError(caught)
          if (credential) setPendingLink({ credential, label: provider.label })
          setError(
            'このメールアドレスは、別の方法ですでに登録されています。'
            + `前回使った方法でログインすると、${provider.label} のアカウントもつながり、次回からどちらでもログインできます。`,
          )
          return
        }
        throw caught
      }
    })
  }

  function submitEmail(event: FormEvent) {
    event.preventDefault()
    if (mode === 'reset') {
      return run('メールアドレス', async () => {
        await sendPasswordResetEmail(auth, email)
        // 登録の有無を知られないよう、登録がなくても同じ知らせを出す
        setNotice('登録されているメールアドレスなら、パスワードを再設定するためのメールを送りました。メールのリンクから再設定してください。')
      })
    }
    if (mode === 'register') {
      if (password.length < MIN_LOGIN_PASSWORD) {
        setError(`パスワードは ${MIN_LOGIN_PASSWORD} 文字以上にしてください。`)
        return
      }
      return run('メールアドレス', async () => {
        const result = await createUserWithEmailAndPassword(auth, email, password)
        await sendEmailVerification(result.user)
      })
    }
    return run('メールアドレス', async () => {
      const result = await signInWithEmailAndPassword(auth, email, password)
      await linkPending(result.user)
    })
  }

  return (
    <Layout title={MODE_TITLES[mode]}>
      <p>家計の記録は、あなたのブラウザの中で暗号化してから保存します。運営する側にも中身は見えません。</p>

      {mode === 'login' && (
        <section aria-labelledby="social-heading" className="flex flex-col gap-4">
          <h2 id="social-heading" className="text-std-20B-150">ほかのサービスのアカウントでログイン</h2>
          <div className="flex flex-col gap-3 desktop:flex-row">
            {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => (
              <Button
                key={providerId}
                type="button"
                variant="outline"
                size="lg"
                aria-disabled={busy || pendingLink?.label === PROVIDERS[providerId].label}
                onClick={() => signInWithProvider(providerId)}
              >
                {PROVIDERS[providerId].label} でログイン
              </Button>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="email-heading" className="flex flex-col gap-4">
        {mode === 'login' && <h2 id="email-heading" className="text-std-20B-150">メールアドレスでログイン</h2>}
        <form className="flex flex-col gap-6" onSubmit={submitEmail} noValidate>
          <Field
            label="メールアドレス"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {mode !== 'reset' && (
            <Field
              label="パスワード"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              support={mode === 'register' ? `${MIN_LOGIN_PASSWORD} 文字以上。家計の暗号化パスワードとは別のものです。` : undefined}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
          {error && <ErrorText role="alert">{error}</ErrorText>}
          {notice && <p role="status" className="text-std-16N-170">{notice}</p>}
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
            {mode === 'login' ? 'ログイン' : mode === 'register' ? '登録して確認メールを送る' : '再設定のメールを送る'}
          </Button>
        </form>
      </section>

      <nav aria-label="ほかの操作" className="flex flex-col items-start gap-3">
        {mode !== 'login' && (
          <Button type="button" variant="text" size="md" onClick={() => switchMode('login')}>ログインに戻る</Button>
        )}
        {mode !== 'register' && (
          <Button type="button" variant="text" size="md" onClick={() => switchMode('register')}>メールアドレスで新しく登録する</Button>
        )}
        {mode !== 'reset' && (
          <Button type="button" variant="text" size="md" onClick={() => switchMode('reset')}>ログインのパスワードを忘れた</Button>
        )}
      </nav>
    </Layout>
  )
}
