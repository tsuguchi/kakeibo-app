import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { needsEmailVerification, useAuth } from './auth/context'
import { PageMessage } from './components/PageMessage'
import { DataProvider } from './data/DataProvider'
import { useKeys } from './keys/context'
import { KeyProvider } from './keys/KeyProvider'
import { AccountsPage } from './pages/AccountsPage'
import { SetupPage } from './pages/crypto/SetupPage'
import { UnlockPage } from './pages/crypto/UnlockPage'
import { LoginPage } from './pages/LoginPage'
import { RecordFormPage } from './pages/records/RecordFormPage'
import { RecordsPage } from './pages/records/RecordsPage'
import { SettingsPage } from './pages/SettingsPage'
import { VerifyEmailPage } from './pages/VerifyEmailPage'

// ログイン → メールアドレスの確認 → 暗号化パスワードの設定またはデータを開く → 記録の画面、の順に進める。
// 記録を開くまでは URL にかかわらず同じ画面を出し、開いた後は URL で画面を切り替える
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
  const { uid, header, keys } = useKeys()
  if (!header) return <SetupPage />
  if (!keys) return <UnlockPage header={header} />
  return (
    <DataProvider uid={uid} keys={keys}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RecordsPage />} />
          <Route path="/records/new" element={<RecordFormPage />} />
          <Route path="/records/:id" element={<RecordFormPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage header={header} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DataProvider>
  )
}

export default App
