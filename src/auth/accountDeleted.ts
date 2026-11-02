// アカウントを削除した直後に、ログイン画面で「削除しました」と知らせるための印。
// ページを読み込み直すと消える（ほかの人がその後に使っても残らない）
let accountDeleted = false

export function markAccountDeleted(): void {
  accountDeleted = true
}

// 読むだけで消さない（開発時の StrictMode では state の初期化が 2 回呼ばれるため、消すのは表示した後にする）
export function wasAccountDeleted(): boolean {
  return accountDeleted
}

export function clearAccountDeleted(): void {
  accountDeleted = false
}
