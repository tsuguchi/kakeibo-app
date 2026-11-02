import type { ReactNode } from 'react'
import { NavLink } from 'react-router'

export const APP_NAME = 'わたしの家計簿'

const NAV_ITEMS = [
  { to: '/', label: '記録' },
  { to: '/summary', label: '集計' },
  { to: '/budgets', label: '予算' },
  { to: '/accounts', label: '口座' },
  { to: '/settings', label: '設定' },
]

// 記録を開いた後の画面で使う、画面の切り替え
export function MainNav() {
  return (
    <nav aria-label="画面の切り替え">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `text-dns-16B-130 underline-offset-[calc(3/16*1rem)] focus-visible:rounded-4 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:bg-yellow-300 ${
                  isActive ? 'text-solid-gray-900 underline decoration-[calc(3/16*1rem)]' : 'text-blue-1000 hover:underline'
                }`}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

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
        <div className="mx-auto flex max-w-160 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
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
