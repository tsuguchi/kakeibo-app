import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'
import { APP_NAME } from '../components/Layout'
import policy from '../../PRIVACY_POLICY.md?raw'

const linkClass = 'text-blue-1000 underline underline-offset-[calc(3/16*1rem)] hover:decoration-[calc(3/16*1rem)] focus-visible:rounded-4 focus-visible:bg-yellow-300 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black'

// 文の中の URL とメールアドレスをリンクにする
function inline(text: string): ReactNode[] {
  return text.split(/(https:\/\/[^\s）)]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g).map((part, index) => {
    if (part.startsWith('https://')) return <a key={index} href={part} className={linkClass} target="_blank" rel="noreferrer">{part}</a>
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(part)) return <a key={index} href={`mailto:${part}`} className={linkClass}>{part}</a>
    return part
  })
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

// PRIVACY_POLICY.md を画面にする。使っている書き方（見出し・段落・箇条書き・表）だけに対応した、HTML を差し込まない変換
function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
    } else if (line.startsWith('# ')) {
      // ページの見出しは Layout の代わりに下で出すので、ここでは飛ばす
      i++
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={i} className="mt-4 text-std-22B-150">{line.slice(3)}</h2>)
      i++
    } else if (line.startsWith('### ')) {
      blocks.push(<h3 key={i} className="text-std-18B-160">{line.slice(4)}</h3>)
      i++
    } else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      blocks.push(<ul key={i} className="flex list-disc flex-col gap-1 pl-6">{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>)
    } else if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]))
      const [header, , ...body] = rows
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-dns-16N-130">
            <thead>
              <tr className="border-b border-solid-gray-420 text-left">
                {header.map((cell, index) => <th key={index} scope="col" className="py-2 pr-3 align-top">{cell}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-solid-gray-200">
                  {row.map((cell, index) => <td key={index} className="py-2 pr-3 align-top">{inline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else {
      const paragraph: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(#|- |\|)/.test(lines[i])) paragraph.push(lines[i++])
      blocks.push(<p key={i}>{inline(paragraph.join(''))}</p>)
    }
  }
  return blocks
}

// プライバシーポリシー。ログインしていなくても読める
export function PrivacyPage() {
  return (
    <>
      <header className="border-b border-solid-gray-420">
        <div className="mx-auto flex max-w-160 items-center justify-between gap-4 px-4 py-3">
          <p className="text-std-18B-160">{APP_NAME}</p>
          <RouterLink to="/" className={`text-dns-16B-130 ${linkClass}`}>アプリに戻る</RouterLink>
        </div>
      </header>
      <main className="mx-auto max-w-160 px-4 py-8">
        <h1 className="text-std-28B-150">プライバシーポリシー</h1>
        <div className="mt-6 flex flex-col gap-4">{renderMarkdown(policy)}</div>
      </main>
    </>
  )
}
