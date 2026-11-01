import type { ReactNode } from 'react'

// 読み込み中やエラーなど、画面全体に 1 行だけ出す知らせ
export function PageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-160 px-4 py-10">
      <p role="status">{children}</p>
    </main>
  )
}
