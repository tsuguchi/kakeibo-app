import { createContext, useContext } from 'react'
import type { CryptoHeader, DataKeys } from '../lib/crypto/keys'

// account: アカウントごと削除する（F-07）／ reset: アカウントは残し、データを消して最初からやり直す（F-85）
export type DeletionMode = 'account' | 'reset'

export interface KeyState {
  uid: string
  // users/{uid} の crypto。まだ設定していなければ null
  header: CryptoHeader | null
  // データを開いた（復号できる）ときの鍵
  keys: DataKeys | null
  // 鍵を使えるようにする。remember が true なら、この端末にも覚える（F-82）
  unlock: (keys: DataKeys, remember: boolean) => Promise<void>
  // 本人確認を済ませてから呼ぶ
  startDeletion: (mode: DeletionMode) => Promise<void>
}

export const KeyContext = createContext<KeyState | null>(null)

export function useKeys(): KeyState {
  const state = useContext(KeyContext)
  if (!state) throw new Error('useKeys は KeyProvider の中で使ってください')
  return state
}
