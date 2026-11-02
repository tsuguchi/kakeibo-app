import { FirebaseError } from 'firebase/app'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { reauthenticate, reauthMethod } from '../auth/reauthenticate'
import { Button } from '../components/dads/Button'
import { Checkbox } from '../components/dads/Checkbox'
import { ErrorText } from '../components/dads/ErrorText'
import { NotificationBanner, NotificationBannerBody } from '../components/dads/NotificationBanner'
import { Field } from '../components/Field'
import { useKeys, type DeletionMode } from '../keys/context'

const TEXT: Record<DeletionMode, { warning: string, confirm: string, button: string }> = {
  account: {
    warning: '記録・分類・口座・予算・自動記録の設定と、ログインのアカウントをすべて削除します。削除したものは、誰にも元に戻せません。',
    confirm: 'すべて削除され、元に戻せないことを理解しました',
    button: 'アカウントを削除する',
  },
  reset: {
    warning: 'これまでの記録・分類・口座・予算・自動記録の設定をすべて削除し、暗号化パスワードの設定からやり直します。ログインのアカウントは残ります。削除したものは、誰にも元に戻せません。',
    confirm: 'これまでのデータがすべて削除され、元に戻せないことを理解しました',
    button: 'データを削除して最初からやり直す',
  },
}

// アカウントの削除（F-07）と、最初からやり直す（F-85）の確認。もう一度ログインして本人であることを確かめる
export function DeleteConfirm({ mode, before }: { mode: DeletionMode, before?: ReactNode }) {
  const { user } = useAuth()
  const { startDeletion } = useKeys()
  const [understood, setUnderstood] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const method = reauthMethod(user!)
  const text = TEXT[mode]

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!understood) {
      setError('内容を確かめて、「理解しました」に印を付けてください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reauthenticate(user!, password)
    } catch (caught) {
      setBusy(false)
      if (caught instanceof FirebaseError) {
        if (caught.code === 'auth/popup-closed-by-user' || caught.code === 'auth/cancelled-popup-request') return
        if (caught.code === 'auth/invalid-credential' || caught.code === 'auth/wrong-password') {
          setError('ログインのパスワードが違います。')
          return
        }
        if (caught.code === 'auth/user-mismatch') {
          setError('いまログインしているのとは別のアカウントが選ばれました。同じアカウントを選んでください。')
          return
        }
      }
      console.error(caught)
      setError('本人確認ができませんでした。時間をおいてもう一度お試しください。')
      return
    }
    await startDeletion(mode)
  }

  return (
    <div className="flex flex-col gap-6">
      <NotificationBanner bannerStyle="standard" type="error" title="元に戻せません" headingLevel="h2">
        <NotificationBannerBody>
          <p>{text.warning}</p>
        </NotificationBannerBody>
      </NotificationBanner>
      {before}
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <Checkbox size="md" checked={understood} onChange={(event) => setUnderstood(event.target.checked)}>
          {text.confirm}
        </Checkbox>
        {method.kind === 'password' ? (
          <Field
            label="本人確認のため、ログインのパスワード"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        ) : (
          <p>本人確認のため、ボタンを押したあと {method.label} でもう一度ログインしてください。</p>
        )}
        {error && <ErrorText role="alert">{error}</ErrorText>}
        <div>
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
            {method.kind === 'popup' ? `${method.label} で本人確認して、${text.button}` : text.button}
          </Button>
        </div>
      </form>
    </div>
  )
}
