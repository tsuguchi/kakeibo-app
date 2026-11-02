import { formatYen } from '../../lib/data/ledger'

export interface RankedBarItem {
  id: string
  label: string
  value: number
}

// 分類別の内訳（F-41）。大きい順の横棒 1 色。棒の先に金額と割合を書き、色だけでは何も伝えない。
// 名前・金額・割合はすべて文字で並べているので、そのまま表の代わりにもなる（F-43）
export function RankedBars({ items, color, label }: { items: RankedBarItem[], color: string, label: string }) {
  const sorted = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, item) => sum + item.value, 0)
  const max = sorted[0]?.value ?? 0

  if (sorted.length === 0) return <p>この月の記録はまだありません。</p>

  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {sorted.map((item) => {
        const share = total > 0 ? Math.round((item.value / total) * 100) : 0
        return (
          <li key={item.id} className="group grid grid-cols-[7em_1fr] items-center gap-x-3 desktop:grid-cols-[9em_1fr]">
            <span className="truncate text-dns-16N-130">{item.label}</span>
            <span className="flex items-center gap-2">
              {/* 棒の太さは 12px（24px 以下）。根元は角、先は 4px の丸み */}
              <span
                aria-hidden="true"
                className="h-3 rounded-r-4 transition-opacity group-hover:opacity-80"
                style={{ width: `${max > 0 ? Math.max((item.value / max) * 70, 1) : 0}%`, backgroundColor: color }}
              />
              <span className="shrink-0 text-dns-14N-130 tabular-nums">
                {formatYen(item.value)}
                <span className="text-solid-gray-600">（{share}%）</span>
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
