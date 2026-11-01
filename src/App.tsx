import { needsEmailVerification, useAuth } from './auth/context'
import { PageMessage } from './components/PageMessage'
import { useKeys } from './keys/context'
import { KeyProvider } from './keys/KeyProvider'
import { SetupPage } from './pages/crypto/SetupPage'
import { UnlockPage } from './pages/crypto/UnlockPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'

// ログイン → メールアドレスの確認 → 暗号化パスワードの設定またはデータを開く → 記録の画面、の順に進める
function App() {
  const { loading, user } = useAuth()

  if (loading) return <PageMessage>読み込み中…</PageMessage>
  if (!user) return <LoginPage />
  if (needsEmailVerification(user)) return <VerifyEmailPage user={user} />
  return (
    <KeyProvider key={user.uid} uid={user.uid}>
      <UnlockedApp />
    </KeyProvider>
  )
}

function UnlockedApp() {
  const { header, keys } = useKeys()
  if (!header) return <SetupPage />
  if (!keys) return <UnlockPage header={header} />
  return <HomePage header={header} />
}

export default App
