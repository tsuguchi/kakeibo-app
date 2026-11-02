import {
  EmailAuthProvider,
  GithubAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type User,
} from 'firebase/auth'

export type ReauthMethod = { kind: 'password' } | { kind: 'popup', providerId: 'google.com' | 'github.com', label: string }

// 本人確認の方法。メールアドレスで登録していればパスワード、そうでなければつないだサービスでログインし直す
export function reauthMethod(user: User): ReauthMethod {
  const providers = user.providerData.map((info) => info.providerId)
  if (providers.includes('password')) return { kind: 'password' }
  if (providers.includes('google.com')) return { kind: 'popup', providerId: 'google.com', label: 'Google' }
  return { kind: 'popup', providerId: 'github.com', label: 'GitHub' }
}

// アカウントの削除など、取り消しのきかない操作の前に、もう一度ログインしてもらう（F-07）
export async function reauthenticate(user: User, password?: string): Promise<void> {
  const method = reauthMethod(user)
  if (method.kind === 'password') {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email ?? '', password ?? ''))
    return
  }
  const provider = method.providerId === 'google.com' ? new GoogleAuthProvider() : new GithubAuthProvider()
  await reauthenticateWithPopup(user, provider)
}
