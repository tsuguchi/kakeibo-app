import { useState, type FormEvent } from 'react'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { NotificationBanner, NotificationBannerBody } from '../components/dads/NotificationBanner'
import { Radio } from '../components/dads/Radio'
import { Field } from '../components/Field'
import { Layout, MainNav } from '../components/Layout'
import { SelectField } from '../components/SelectField'
import { useData } from '../data/context'
import { newId } from '../lib/data/defaults'
import { formatMonth, formatYen, monthOf, parseAmount, shiftMonth, today, validateTransaction } from '../lib/data/ledger'
import { defaultShift, HOLIDAY_DATA_LAST_YEAR, SHIFT_LABELS, type RecurringRule, type ShiftRule } from '../lib/data/recurring'
import { TRANSACTION_TYPE_LABELS, type TransactionType } from '../lib/data/types'

function dayLabel(day: number | 'last'): string {
  return day === 'last' ? '月末' : `${day}日`
}

// 毎月の自動記録の設定（F-60〜F-66）
export function RecurringPage() {
  const { store, recurring, categoryName, accountName } = useData()
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(rule: RecurringRule) {
    setBusyId(rule.id)
    setError(null)
    try {
      // 再開するときは、止めていた間の分をまとめて作らないよう、今月の前の月まで作り終えたことにする
      const resumeFrom = shiftMonth(monthOf(today()), -1)
      await store.updateRecurring((items) => items.map((item) => (item.id !== rule.id
        ? item
        : { ...item, active: !item.active, generatedThrough: item.active ? item.generatedThrough : (item.generatedThrough < resumeFrom ? resumeFrom : item.generatedThrough) })))
    } catch (caught) {
      console.error(caught)
      setError('変更できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusyId(null)
    }
  }

  if (editing) {
    return (
      <Layout title={editing === 'new' ? '自動記録を追加する' : '自動記録を変更する'} headerEnd={<MainNav />}>
        <RecurringForm rule={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </Layout>
    )
  }

  const sorted = [...recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.memo.localeCompare(b.memo, 'ja'))

  return (
    <Layout title="毎月の自動記録" headerEnd={<MainNav />}>
      <p>
        家賃やサブスクなど、毎月同じ収入・支出・振替を登録しておくと、日付が来たときにアプリを開くと自動で記録します。
        自動で記録した分は、ふつうの記録と同じく変更・削除できます。
      </p>
      <div>
        <Button type="button" variant="solid-fill" size="lg" onClick={() => setEditing('new')}>自動記録を追加する</Button>
      </div>
      {error && <ErrorText role="alert">{error}</ErrorText>}

      <section aria-labelledby="list-heading" className="flex flex-col gap-2">
        <h2 id="list-heading" className="text-std-20B-150">登録した自動記録</h2>
        {sorted.length === 0 && <p>まだありません。</p>}
        <ul>
          {sorted.map((rule) => (
            <li key={rule.id} className="flex flex-col gap-2 border-b border-solid-gray-200 py-4">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-std-16B-170">
                  {rule.memo || (rule.type === 'transfer' ? '振替' : categoryName(rule.categoryId))}
                  {!rule.active && <span className="ml-2 text-dns-14B-130 text-solid-gray-600">（停止中）</span>}
                </span>
                <span className="text-dns-17B-130">{TRANSACTION_TYPE_LABELS[rule.type]} {formatYen(rule.amount)}</span>
              </p>
              <p className="text-dns-14N-130 text-solid-gray-600">
                毎月{dayLabel(rule.day)}・休日は{SHIFT_LABELS[rule.shift]}・
                {rule.type === 'transfer' ? `${accountName(rule.accountId)} → ${accountName(rule.toAccountId)}` : `${categoryName(rule.categoryId)}・${accountName(rule.accountId)}`}
              </p>
              <p className="text-dns-14N-130 text-solid-gray-600">
                {formatMonth(rule.startMonth)}から{rule.endMonth ? `${formatMonth(rule.endMonth)}まで` : ''}
                {rule.generatedThrough >= rule.startMonth && `（${formatMonth(rule.generatedThrough)}の分まで記録済み）`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" aria-label={`${rule.memo || '自動記録'}を変更`} onClick={() => setEditing(rule)}>変更</Button>
                <Button type="button" variant="text" size="sm" aria-disabled={busyId === rule.id} onClick={() => toggle(rule)}>
                  {rule.active ? '停止する' : '再開する'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </Layout>
  )
}

function RecurringForm({ rule, onDone }: { rule: RecurringRule | null, onDone: () => void }) {
  const { store, categories, accounts } = useData()
  const thisMonth = monthOf(today())
  const [type, setType] = useState<TransactionType>(rule?.type ?? 'expense')
  const [day, setDay] = useState<string>(String(rule?.day ?? 27))
  const [amount, setAmount] = useState(rule ? String(rule.amount) : '')
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '')
  const [accountId, setAccountId] = useState(rule?.accountId ?? accounts.find((account) => !account.hidden)?.id ?? '')
  const [toAccountId, setToAccountId] = useState(rule?.toAccountId ?? '')
  const [memo, setMemo] = useState(rule?.memo ?? '')
  const [startMonth, setStartMonth] = useState(rule?.startMonth ?? thisMonth)
  const [endMonth, setEndMonth] = useState(rule?.endMonth ?? '')
  const [shift, setShift] = useState<ShiftRule>(rule?.shift ?? defaultShift('expense'))
  const [shiftTouched, setShiftTouched] = useState(Boolean(rule))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categoryOptions = categories
    .filter((category) => category.kind === type && (!category.hidden || category.id === categoryId))
    .sort((a, b) => a.order - b.order)
    .map((category) => ({ value: category.id, label: category.name }))
  const accountOptions = accounts
    .filter((account) => !account.hidden || account.id === accountId || account.id === toAccountId)
    .map((account) => ({ value: account.id, label: account.name }))
  const dayOptions = [...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` })), { value: 'last', label: '月末' }]
  const startsAfterHolidayData = Number(startMonth.slice(0, 4)) > HOLIDAY_DATA_LAST_YEAR || !endMonth || Number(endMonth.slice(0, 4)) > HOLIDAY_DATA_LAST_YEAR

  function changeType(next: TransactionType) {
    if (next !== type) setCategoryId('')
    setType(next)
    // 利用者がまだ選んでいなければ、種類に合った初期値にする（収入は前の平日、支出と振替は次の平日）
    if (!shiftTouched) setShift(defaultShift(next))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseAmount(amount)
    if (parsed === null) {
      setError('金額は 1 円以上の整数で入力してください。')
      return
    }
    if (!/^\d{4}-\d{2}$/.test(startMonth)) {
      setError('開始の月を入力してください。')
      return
    }
    if (endMonth && endMonth < startMonth) {
      setError('終了の月は、開始の月より後にしてください。')
      return
    }
    // 中身の確かめは、記録と同じ決まりを使う（日付は仮に開始の月の 1 日にする）
    const invalid = validateTransaction({
      type, date: `${startMonth}-01`, amount: parsed,
      categoryId: type === 'transfer' ? null : categoryId || null,
      accountId, toAccountId: type === 'transfer' ? toAccountId || null : null,
      memo, source: { kind: 'recurring' },
    })
    if (invalid) {
      setError(invalid)
      return
    }
    setError(null)
    setBusy(true)
    const next: RecurringRule = {
      id: rule?.id ?? newId(),
      type,
      day: day === 'last' ? 'last' : Number(day),
      amount: parsed,
      categoryId: type === 'transfer' ? null : categoryId,
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      memo: memo.trim(),
      startMonth,
      endMonth: endMonth || null,
      shift,
      active: rule?.active ?? true,
      // 新しく作るときは、開始の月の前の月まで作り終えたことにする。
      // 変更で開始の月を後ろにずらしたときも、それより前の分は作らない
      generatedThrough: rule && rule.generatedThrough >= shiftMonth(startMonth, -1) ? rule.generatedThrough : shiftMonth(startMonth, -1),
    }
    try {
      await store.updateRecurring((items) => (rule ? items.map((item) => (item.id === rule.id ? next : item)) : [...items, next]))
      onDone()
    } catch (caught) {
      console.error(caught)
      setError('保存できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      {rule && <p>変更しても、すでに記録した分は変わりません。</p>}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-std-17B-170">種類</legend>
        <div className="flex flex-wrap gap-x-6">
          {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((value) => (
            <Radio key={value} name="type" value={value} size="md" checked={type === value} onChange={() => changeType(value)}>
              {TRANSACTION_TYPE_LABELS[value]}
            </Radio>
          ))}
        </div>
      </fieldset>

      <Field label="名前（メモ）" autoComplete="off" maxLength={200} support="記録のメモにもなります（例: 家賃）。" value={memo} onChange={(event) => setMemo(event.target.value)} />
      <Field label="金額（円）" inputMode="numeric" autoComplete="off" required className="w-60" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <SelectField label="毎月の日付" value={day} onChange={setDay} options={dayOptions} support="その月にない日付（例: 31 日）は、月末に記録します。" />

      <fieldset className="flex flex-col gap-1">
        <legend className="text-std-17B-170">土日・祝日に当たったとき</legend>
        <p className="text-std-16N-170 text-solid-gray-600">給料は前の平日、口座の引き落としは次の平日になることが多いです。</p>
        <div className="flex flex-wrap gap-x-6">
          {(Object.keys(SHIFT_LABELS) as ShiftRule[]).map((value) => (
            <Radio key={value} name="shift" value={value} size="md" checked={shift === value} onChange={() => { setShift(value); setShiftTouched(true) }}>
              {SHIFT_LABELS[value]}
            </Radio>
          ))}
        </div>
      </fieldset>

      {type !== 'transfer' && <SelectField label="分類" value={categoryId} onChange={setCategoryId} options={categoryOptions} />}
      <SelectField label={type === 'transfer' ? '出金元の口座' : '口座'} value={accountId} onChange={setAccountId} options={accountOptions} />
      {type === 'transfer' && <SelectField label="入金先の口座" value={toAccountId} onChange={setToAccountId} options={accountOptions} />}

      <Field label="開始の月" type="month" required className="w-60" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} />
      <Field label="終了の月（任意）" type="month" className="w-60" support="空欄なら、止めるまで続けます。" value={endMonth} onChange={(event) => setEndMonth(event.target.value)} />

      {shift !== 'none' && startsAfterHolidayData && (
        <NotificationBanner bannerStyle="standard" type="info1" title="祝日の一覧について" headingLevel="h2">
          <NotificationBannerBody>
            <p>
              アプリに入っている祝日の一覧は {HOLIDAY_DATA_LAST_YEAR} 年までです。それより先の年は、一覧が更新されるまで、
              土日と年末年始（12 月 31 日〜1 月 3 日）だけを休日として扱います。
            </p>
          </NotificationBannerBody>
        </NotificationBanner>
      )}

      {error && <ErrorText role="alert">{error}</ErrorText>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>{rule ? '変更を保存する' : '追加する'}</Button>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>やめる</Button>
      </div>
    </form>
  )
}
