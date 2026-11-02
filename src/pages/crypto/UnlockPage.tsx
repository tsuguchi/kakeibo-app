import { useState, type FormEvent } from 'react'
import { logout } from '../../auth/logout'
import { Button } from '../../components/dads/Button'
import { Checkbox } from '../../components/dads/Checkbox'
import { ErrorText } from '../../components/dads/ErrorText'
import { Field } from '../../components/Field'
import { Layout } from '../../components/Layout'
import { resetPasswordWithRecovery, unlockWithPassword, WrongSecretError, type CryptoHeader } from '../../lib/crypto/keys'
import { db } from '../../lib/firebase'
import { updateCryptoHeader } from '../../lib/userCrypto'
import { useKeys } from '../../keys/context'
import { DeleteConfirm } from '../DeleteConfirm'
import { MIN_CRYPTO_PASSWORD, validateNewCryptoPassword } from './passwordRules'

// 新しい端末やブラウザで、暗号化パスワードか復旧キーでデータを開く（F-81、F-84）
export function UnlockPage({ header }: { header: CryptoHeader }) {
  const { uid, unlock } = useKeys()
  const [mode, setMode] = useState<'password' | 'recovery' | 'reset'>('password')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>, wrongMessage: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      if (caught instanceof WrongSecretError) {
        setError(wrongMessage)
      } else {
        console.error(caught)
        setError('うまくいきませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      }
      setBusy(false)
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    return run(async () => {
      await unlock(await unlockWithPassword(header, password), remember)
    }, '暗号化パスワードが違います。')
  }

  function submitRecovery(event: FormEvent) {
    event.preventDefault()
    const invalid = validateNewCryptoPassword(newPassword, confirmation)
    setError(invalid)
    if (invalid) return
    return run(async () => {
      const reset = await resetPasswordWithRecovery(header, recoveryCode, newPassword)
      await updateCryptoHeader(db, uid, reset.header)
      await unlock(reset.keys, remember)
    }, '復旧キーが違います。区切りの「-」はあってもなくてもかまいません。')
  }

  function switchMode(next: 'password' | 'recovery' | 'reset') {
    setMode(next)
    setError(null)
  }

  const rememberCheckbox = (
    <label className="flex items-start gap-2">
      <Checkbox checked={remember} onChange={(event) => setRemember(event.target.checked)} />
      <span>この端末で覚える（家族などと共用の端末では選ばないでください）</span>
    </label>
  )

  const headerEnd = <Button type="button" variant="text" size="sm" onClick={logout}>ログアウト</Button>

  // 暗号化パスワードと復旧キーの両方をなくしたとき（F-85）
  if (mode === 'reset') {
    return (
      <Layout title="最初からやり直す" headerEnd={headerEnd}>
        <p>
          暗号化パスワードと復旧キーの両方をなくすと、これまでの記録は誰にも開けません（運営する側も開けません）。
          できるのは、これまでのデータを削除して、暗号化パスワードの設定から始め直すことだけです。
        </p>
        <DeleteConfirm mode="reset" />
        <div>
          <Button type="button" variant="text" size="md" onClick={() => switchMode('recovery')}>復旧キーで開く</Button>
        </div>
      </Layout>
    )
  }

  if (mode === 'recovery') {
    return (
      <Layout title="復旧キーで開く" headerEnd={headerEnd}>
        <p>最初の設定のときに保管した復旧キーを入力し、新しい暗号化パスワードを決めてください。</p>
        <form className="flex flex-col gap-6" onSubmit={submitRecovery} noValidate>
          <Field
            label="復旧キー"
            autoComplete="off"
            spellCheck={false}
            support="4 文字ずつ「-」で区切られた 32 文字です。"
            required
            value={recoveryCode}
            onChange={(event) => setRecoveryCode(event.target.value)}
          />
          <Field
            label="新しい暗号化パスワード"
            type="password"
            autoComplete="new-password"
            support={`${MIN_CRYPTO_PASSWORD} 文字以上。`}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Field
            label="新しい暗号化パスワード（確認のためもう一度）"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          {rememberCheckbox}
          {error && <ErrorText role="alert">{error}</ErrorText>}
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
            {busy ? '確かめています…' : '新しい暗号化パスワードで開く'}
          </Button>
        </form>
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="text" size="md" onClick={() => switchMode('password')}>暗号化パスワードで開く</Button>
          <Button type="button" variant="text" size="md" onClick={() => switchMode('reset')}>復旧キーもなくした（最初からやり直す）</Button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title="記録を開く" headerEnd={headerEnd}>
      <p>この端末では、まだ記録を開いていません。暗号化パスワードを入力してください。</p>
      <form className="flex flex-col gap-6" onSubmit={submitPassword} noValidate>
        <Field
          label="暗号化パスワード"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {rememberCheckbox}
        {error && <ErrorText role="alert">{error}</ErrorText>}
        <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
          {busy ? '確かめています…' : '開く'}
        </Button>
      </form>
      <div>
        <Button type="button" variant="text" size="md" onClick={() => switchMode('recovery')}>
          暗号化パスワードを忘れた（復旧キーで開く）
        </Button>
      </div>
    </Layout>
  )
}
