import type { ReactNode } from 'react'

export const APP_NAME = 'わたしの家計簿'

// 画面の共通の枠。見出しの下に中身を置く
export function Layout({ title, headerEnd, children }: { title: string, headerEnd?: ReactNode, children: ReactNode }) {
  return (
    <>
      <header className="border-b border-solid-gray-420">
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
