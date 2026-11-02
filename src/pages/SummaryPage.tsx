import { useEffect, useState } from 'react'
import { SERIES_COLORS } from '../components/charts/colors'
import { MonthlyColumns, type MonthTotals } from '../components/charts/MonthlyColumns'
import { RankedBars } from '../components/charts/RankedBars'
import { Layout, MainNav } from '../components/Layout'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { useMonth } from '../components/useMonth'
import { useData } from '../data/context'
import { emptySummary, formatMonth, shiftMonth } from '../lib/data/ledger'
import type { CategoryKind, Summary } from '../lib/data/types'

// 集計（F-41〜F-43）。選んだ月の分類別の内訳と、その月までの 12 か月の移り変わり。
// 読み込むのは月ごとの集計 12 件だけ（記録そのものは読まない）
export function SummaryPage() {
  const { store, categories } = useData()
  const [month, setMonth] = useMonth()
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(month, i - 11))
  const monthsKey = months.join(',')
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsubscribes = monthsKey.split(',').map((m) => store.subscribeSummary(m, (summary) => setSummaries((current) => ({ ...current, [m]: summary })), setError))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [store, monthsKey])

  const loaded = months.every((m) => summaries[m])
  const current = summaries[month] ?? emptySummary()
  const trend: MonthTotals[] = months.map((m) => ({ month: m, income: summaries[m]?.income ?? 0, expense: summaries[m]?.expense ?? 0 }))

  function breakdown(kind: CategoryKind) {
    return categories
      .filter((category) => category.kind === kind)
      .map((category) => ({ id: category.id, label: category.name, value: current.byCategory[category.id] ?? 0 }))
  }

  return (
    <Layout title={`集計（${formatMonth(month)}）`} headerEnd={<MainNav />}>
      <MonthSwitcher month={month} onChange={setMonth} />
      {error && <p role="alert" className="text-error-1">集計を読み込めませんでした。ページを読み込み直してください。</p>}
      {!error && !loaded && <p role="status">読み込み中…</p>}

      {/* 読み込み直しの間も前の表示を薄く残し、画面が跳ねないようにする */}
      <div className={`flex flex-col gap-8 transition-opacity ${loaded ? '' : 'opacity-50'}`}>
        <section aria-labelledby="expense-heading" className="flex flex-col gap-4">
          <h2 id="expense-heading" className="text-std-20B-150">支出の内訳</h2>
          <RankedBars label={`${formatMonth(month)}の支出の内訳`} items={breakdown('expense')} color={SERIES_COLORS.expense} />
        </section>

        <section aria-labelledby="income-heading" className="flex flex-col gap-4">
          <h2 id="income-heading" className="text-std-20B-150">収入の内訳</h2>
          <RankedBars label={`${formatMonth(month)}の収入の内訳`} items={breakdown('income')} color={SERIES_COLORS.income} />
        </section>

        <section aria-labelledby="trend-heading" className="flex flex-col gap-4">
          <h2 id="trend-heading" className="text-std-20B-150">12 か月の移り変わり</h2>
          <p className="text-dns-14N-130 text-solid-gray-600">
            {formatMonth(months[0])}〜{formatMonth(month)}。月を選ぶと金額が出ます。振替は含みません。
          </p>
          <MonthlyColumns data={trend} />
        </section>
      </div>
    </Layout>
  )
}
