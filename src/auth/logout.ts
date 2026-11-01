import { signOut } from 'firebase/auth'
import { clearDeviceKeys } from '../lib/crypto/deviceStore'
import { auth } from '../lib/firebase'

// ログアウトすると、この端末に覚えた鍵も消す（F-82）
export async function logout(): Promise<void> {
  await clearDeviceKeys()
  await signOut(auth)
}
