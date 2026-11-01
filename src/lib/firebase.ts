import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
})

export const auth = getAuth(app)
auth.languageCode = 'ja'
export const db = getFirestore(app)

// 開発時は Firebase Emulator に接続し、本番のデータに触れないようにする
if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  // Auth Emulator のホスト名は、アプリを開いているホスト名にそろえる。
  // localhost と 127.0.0.1 は別のサイトとして扱われ、ログインのポップアップが使う Emulator の iframe が
  // サードパーティ扱いでブロック・隔離されると「No matching frame」で失敗するため
  connectAuthEmulator(auth, `http://${window.location.hostname}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
