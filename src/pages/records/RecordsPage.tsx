import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Button } from '../../components/dads/Button'
import { Input } from '../../components/dads/Input'
import { Layout, MainNav } from '../../components/Layout'
import { MonthSwitcher } from '../../components/MonthSwitcher'
import { useMonth } from '../../components/useMonth'
import { useData } from '../../data/context'
import { emptySummary, formatMonth, formatYen, monthOf, today } from '../../lib/data/ledger'
import type { Summary, Transaction } from '../../lib/data/types'
import { amountLabel } from './amount'

// 記録の一覧（ホーム）。月ごとの収入・支出・差額と、その月の記録（F-13、F-40）
export function RecordsPage() {
  const { store, categoryName, accountName } = useData()
  const [month, setMonth] = useMonth()
  const [loaded, setLoaded] = useState<{ month: string, transactions: Transaction[] } | null>(null)
  const [summary, setSummary] = useState<{ month: string, value: Summary } | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => store.subscribeMonth(month, (transactions) => setLoaded({ month, transactions }), setError), [store, month])
  useEffect(() => store.subscribeSummary(month, (value) => setSummary({ month, value }), setError), [store, month])

  // 月を切り替えた直後は、前の月の分を出さない
  const transactions = loaded?.month === month ? loaded.transactions : null
  const totals = summary?.month === month ? summary.value : emptySummary()

  const keyword = filter.trim().normalize('NFKC').toLowerCase()
  const visible = (transactions ?? []).filter((tx) => {
    if (!keyword) return true
    const text = [tx.memo, categoryName(tx.categoryId), accountName(tx.accountId), tx.toAccountId ? accountName(tx.toAccountId) : '']
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
    return text.includes(keyword)
  })

  // 日付ごとにまとめる（記録は日付の新しい順に並んでいる）
  const groups: { date: string, items: Transaction[] }[] = []
  for (const tx of visible) {
    const last = groups.at(-1)
    if (last?.date === tx.date) last.items.push(tx)
    else groups.push({ date: tx.date, items: [tx] })
  }

  const newRecordDate = month === monthOf(today()) ? today() : `${month}-01`

  return (
    <Layout title={formatMonth(month)} headerEnd={<MainNav />}>
      <MonthSwitcher month={month} onChange={setMonth} />

      <section aria-labelledby="summary-heading">
        <h2 id="summary-heading" className="sr-only">{formatMonth(month)}の収支</h2>
        <dl className="grid grid-cols-3 gap-2 rounded-8 border border-solid-gray-420 p-4 text-center">
          <div>
            <dt className="text-dns-14N-130 text-solid-gray-600">収入</dt>
            <dd className="mt-1 text-dns-17B-130 desktop:text-std-20B-150">{formatYen(totals.income)}</dd>
          </div>
          <div>
            <dt className="text-dns-14N-130 text-solid-gray-600">支出</dt>
            <dd className="mt-1 text-dns-17B-130 desktop:text-std-20B-150">{formatYen(totals.expense)}</dd>
          </div>
          <div>
            <dt className="text-dns-14N-130 text-solid-gray-600">差額</dt>
            <dd className={`mt-1 text-dns-17B-130 desktop:text-std-20B-150 ${totals.income - totals.expense < 0 ? 'text-error-1' : ''}`}>
              {totals.income - totals.expense < 0 ? '−' : ''}
              {formatYen(Math.abs(totals.income - totals.expense))}
            </dd>
          </div>
        </dl>
      </section>

      <div>
        <Button asChild variant="solid-fill" size="lg">
          <RouterLink to={`/records/new?date=${newRecordDate}`}>記録する</RouterLink>
        </Button>
      </div>

      <section aria-labelledby="list-heading" className="flex flex-col gap-4">
        <h2 id="list-heading" className="text-std-20B-150">記録の一覧</h2>
        <div className="flex flex-col gap-2">
          <label htmlFor="filter" className="text-std-16B-170">絞り込み</label>
          <p id="filter-support" className="text-dns-16N-130 text-solid-gray-600">分類・口座・メモの文字で絞り込めます。</p>
          <Input
            id="filter"
            type="search"
            blockSize="md"
            className="w-full"
            aria-describedby="filter-support"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>

        {error && <p role="alert" className="text-error-1">記録を読み込めませんでした。ページを読み込み直してください。</p>}
        {!error && !transactions && <p role="status">読み込み中…</p>}
        {transactions && transactions.length === 0 && <p>この月の記録はまだありません。</p>}
        {transactions && transactions.length > 0 && visible.length === 0 && <p>絞り込みに合う記録はありません。</p>}

        {groups.map((group) => (
          <section key={group.date} aria-label={formatDay(group.date)}>
            <h3 className="border-b border-solid-gray-420 pb-1 text-dns-16B-130 text-solid-gray-600">{formatDay(group.date)}</h3>
            <ul>
              {group.items.map((tx) => (
                <li key={tx.id} className="border-b border-solid-gray-200">
                  <RouterLink
                    to={`/records/${tx.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-solid-gray-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:bg-yellow-300"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-std-16B-170">
                        {tx.type === 'transfer' ? '振替' : categoryName(tx.categoryId)}
                        {tx.source.kind === 'recurring' && <span className="ml-2 text-dns-14N-130 text-solid-gray-600">（自動）</span>}
                      </span>
                      <span className="block truncate text-dns-14N-130 text-solid-gray-600">
                        {tx.type === 'transfer' ? `${accountName(tx.accountId)} → ${accountName(tx.toAccountId)}` : accountName(tx.accountId)}
                        {tx.memo && `・${tx.memo}`}
                      </span>
                    </span>
                    <span className={`shrink-0 text-dns-17B-130 ${tx.type === 'income' ? 'text-success-2' : ''}`}>
                      {amountLabel(tx)}
                    </span>
                  </RouterLink>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </Layout>
  )
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日（${weekday}）`
}
