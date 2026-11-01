import { onAuthStateChanged, type User } from 'firebase/auth'
import { useEffect, useState, type ReactNode } from 'react'
import { auth } from '../lib/firebase'
import { AuthContext } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  // User は同じオブジェクトのまま中身が変わるので、読み直したときに画面を描き直すための番号
  const [, setVersion] = useState(0)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setLoading(false)
    })
  }, [])

  async function refresh() {
    if (!auth.currentUser) return
    await auth.currentUser.reload()
    // Security Rules が見る email_verified を新しくするため、ID トークンも取り直す
    await auth.currentUser.getIdToken(true)
    setUser(auth.currentUser)
    setVersion((version) => version + 1)
  }

  return <AuthContext value={{ loading, user, refresh }}>{children}</AuthContext>
}
