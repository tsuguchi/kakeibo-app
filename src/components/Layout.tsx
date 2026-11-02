import type { ReactNode } from 'react'

export const APP_NAME = 'わたしの家計簿'

// 画面の共通の枠。見出しの下に中身を置く
export function Layout({ title, headerEnd, children }: { title: string, headerEnd?: ReactNode, children: ReactNode }) {
  return (
    <>
      <header className="border-b border-solid-gray-420">
        {/* 本番と見分けられるよう、練習用の Firebase（Emulator）につないでいるときだけ出す */}
        {import.meta.env.VITE_USE_EMULATOR === 'true' && (
          <p className="bg-yellow-300 px-4 py-1 text-center text-dns-16B-130 text-solid-gray-900">
            練習用（Emulator）につないでいます。本番のデータではありません。
          </p>
        )}
        <div className="mx-auto flex max-w-160 items-center justify-between gap-4 px-4 py-3">
          <p className="text-std-18B-160">{APP_NAME}</p>
          {headerEnd}
        </div>
      </header>
      <main className="mx-auto max-w-160 px-4 py-8">
        <h1 className="text-std-28B-150">{title}</h1>
        <div className="mt-6 flex flex-col gap-8">{children}</div>
      </main>
    </>
  )
}
