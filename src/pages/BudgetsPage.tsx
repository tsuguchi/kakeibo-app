import { useEffect, useState, type FormEvent } from 'react'
import { BudgetMeter } from '../components/charts/BudgetMeter'
import { Button } from '../components/dads/Button'
import { Field } from '../components/Field'
import { Layout, MainNav } from '../components/Layout'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { useMonth } from '../components/useMonth'
import { useData } from '../data/context'
import { budgetFor, emptySummary, formatMonth, formatYen, parseAmount, setBudget } from '../lib/data/ledger'
import type { Category, Summary } from '../lib/data/types'

// 予算（F-50〜F-52）。分類ごとに月の予算を決め、使った額と残りを見る。
// 決めた予算は翌月以降にも引き継ぎ、ある月から変えることもできる
export function BudgetsPage() {
  const { store, categories, budgets } = useData()
  const [month, setMonth] = useMonth()
  const [summary, setSummary] = useState<{ month: string, value: Summary } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => store.subscribeSummary(month, (value) => setSummary({ month, value }), console.error), [store, month])
  const used = summary?.month === month ? summary.value.byCategory : emptySummary().byCategory

  const expenseCategories = categories.filter((category) => category.kind === 'expense' && !category.hidden).sort((a, b) => a.order - b.order)
  const rows = expenseCategories.map((category) => ({ category, budget: budgetFor(budgets, category.id, month), used: used[category.id] ?? 0 }))
  const withBudget = rows.filter((row) => row.budget !== null)
  const totalBudget = withBudget.reduce((sum, row) => sum + row.budget!, 0)
  const totalUsed = withBudget.reduce((sum, row) => sum + row.used, 0)
  const overCount = withBudget.filter((row) => row.used > row.budget!).length

  return (
    <Layout title={`予算（${formatMonth(month)}）`} headerEnd={<MainNav />}>
      <MonthSwitcher month={month} onChange={setMonth} />
      <p>予算は、決めた月から先の月にも引き継ぎます。ある月から金額を変えると、その月から先だけが変わります。</p>

      {withBudget.length > 0 && (
        <section aria-labelledby="total-heading" className="flex flex-col gap-3 rounded-8 border border-solid-gray-420 p-4">
          <h2 id="total-heading" className="text-std-18B-160">予算を決めた分類の合計</h2>
          <BudgetMeter label={`${formatMonth(month)}の予算の合計`} used={totalUsed} budget={totalBudget} />
          {overCount > 0 && <p className="text-dns-16B-130 text-error-1">予算を超えた分類が {overCount} つあります。</p>}
        </section>
      )}

      <section aria-labelledby="list-heading" className="flex flex-col gap-2">
        <h2 id="list-heading" className="text-std-20B-150">支出の分類ごとの予算</h2>
        <ul>
          {rows.map(({ category, budget, used: categoryUsed }) => (
            <li key={category.id} className="flex flex-col gap-3 border-b border-solid-gray-200 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-std-16B-170">{category.name}</span>
                {editingId !== category.id && (
                  <Button type="button" variant="outline" size="sm" aria-label={`${category.name}の予算を${budget === null ? '決める' : '変える'}`} onClick={() => setEditingId(category.id)}>
                    {budget === null ? '予算を決める' : '予算を変える'}
                  </Button>
                )}
              </div>
              {editingId === category.id ? (
                <BudgetEditor category={category} month={month} current={budget} onDone={() => setEditingId(null)} />
              ) : budget === null ? (
                <p className="text-dns-14N-130 text-solid-gray-600">予算なし（この月に使った額 {formatYen(categoryUsed)}）</p>
              ) : (
                <BudgetMeter label={`${category.name}の予算`} used={categoryUsed} budget={budget} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  )
}

function BudgetEditor({ category, month, current, onDone }: { category: Category, month: string, current: number | null, onDone: () => void }) {
  const { store } = useData()
  const [amount, setAmount] = useState(current === null ? '' : String(current))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(next: number | null) {
    setBusy(true)
    setError(null)
    try {
      await store.updateBudgets((items) => setBudget(items, category.id, month, next))
      onDone()
    } catch (caught) {
      console.error(caught)
      setError('保存できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseAmount(amount)
    if (parsed === null) {
      setError('予算は 1 円以上の整数で入力してください。')
      return
    }
    void save(parsed)
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} noValidate aria-label={`${category.name}の予算`}>
      <Field
        label={`${formatMonth(month)}から先の予算（円）`}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        className="w-60"
        value={amount}
        error={error}
        onChange={(event) => setAmount(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid-fill" size="md" aria-disabled={busy}>保存する</Button>
        {current !== null && (
          <Button type="button" variant="outline" size="md" aria-disabled={busy} onClick={() => save(null)}>
            {formatMonth(month)}から予算なしにする
          </Button>
        )}
        <Button type="button" variant="text" size="md" onClick={onDone}>やめる</Button>
      </div>
    </form>
  )
}
