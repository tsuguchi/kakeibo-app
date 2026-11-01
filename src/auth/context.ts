import type { User } from 'firebase/auth'
import { createContext, useContext } from 'react'

export interface AuthState {
  // ログインの状態を確認中は true
  loading: boolean
  user: User | null
  // メールアドレスの確認（F-03）が済んだ後などに、ログインの情報を読み直す
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth は AuthProvider の中で使ってください')
  return state
}

// メールアドレスとパスワードで登録した人は、メールアドレスを確認するまで家計のデータを使えない（F-03）。
// Google と GitHub でログインした人には、この条件を付けない（Security Rules と同じ条件）
export function needsEmailVerification(user: User): boolean {
  return !user.emailVerified && user.providerData.every((info) => info.providerId === 'password')
}
