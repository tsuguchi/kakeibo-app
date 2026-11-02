import { useEffect, useId, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Button } from '../../components/dads/Button'
import { ErrorText } from '../../components/dads/ErrorText'
import { Radio } from '../../components/dads/Radio'
import { Select } from '../../components/dads/Select'
import { Field } from '../../components/Field'
import { Layout, MainNav } from '../../components/Layout'
import { PageMessage } from '../../components/PageMessage'
import { useData } from '../../data/context'
import { isValidDate, monthOf, parseAmount, today, validateTransaction } from '../../lib/data/ledger'
import { TRANSACTION_TYPE_LABELS, type Transaction, type TransactionData, type TransactionType } from '../../lib/data/types'

interface FormValues {
  type: TransactionType
  date: string
  amount: string
  categoryId: string
  accountId: string
  toAccountId: string
  memo: string
}

function toFormValues(tx: Transaction, date: string): FormValues {
  return {
    type: tx.type,
    date,
    amount: String(tx.amount),
    categoryId: tx.categoryId ?? '',
    accountId: tx.accountId,
    toAccountId: tx.toAccountId ?? '',
    memo: tx.memo,
  }
}

// 記録の入力（F-10〜F-12、F-14、F-15）。/records/new で新しく、/records/:id で変更・削除する。
// /records/new?copy=:id なら、その記録を写して今日の日付で新しく作る
export function RecordFormPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const copyId = searchParams.get('copy')
  const sourceId = id ?? copyId
  const { store } = useData()
  const [source, setSource] = useState<Transaction | null | undefined>(sourceId ? undefined : null)

  useEffect(() => {
    if (!sourceId) return
    let cancelled = false
    store.getTransaction(sourceId).then(
      (tx) => !cancelled && setSource(tx),
      (error) => {
        console.error(error)
        if (!cancelled) setSource(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [store, sourceId])

  if (source === undefined) return <PageMessage>読み込み中…</PageMessage>
  if (id && !source) {
    return (
      <Layout title="記録が見つかりません" headerEnd={<MainNav />}>
        <p>この記録は削除されたか、開けませんでした。</p>
      </Layout>
    )
  }

  const dateParam = searchParams.get('date')
  const initialDate = dateParam && isValidDate(dateParam) ? dateParam : today()
  return (
    <RecordForm
      key={`${id ?? 'new'}-${copyId ?? ''}`}
      editingId={id ?? null}
      initial={source ? toFormValues(source, id ? source.date : initialDate) : null}
      initialDate={initialDate}
    />
  )
}

function RecordForm({ editingId, initial, initialDate }: { editingId: string | null, initial: FormValues | null, initialDate: string }) {
  const { store, categories, accounts } = useData()
  const navigate = useNavigate()
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const [values, setValues] = useState<FormValues>(
    initial ?? {
      type: 'expense',
      date: initialDate,
      amount: '',
      categoryId: '',
      accountId: visibleAccounts[0]?.id ?? '',
      toAccountId: '',
      memo: '',
    },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const kindCategories = categories
    .filter((category) => category.kind === values.type && (!category.hidden || category.id === values.categoryId))
    .sort((a, b) => a.order - b.order)
  const accountOptions = accounts.filter((account) => !account.hidden || account.id === values.accountId || account.id === values.toAccountId)

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value }
      // 収入と支出では分類の一覧が違うので、種類を変えたら分類を選び直してもらう
      if (key === 'type' && value !== current.type) next.categoryId = ''
      return next
    })
  }

  function backToList(date: string) {
    navigate(`/?month=${monthOf(date)}`)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const amount = parseAmount(values.amount)
    if (amount === null) {
      setError('金額は 1 円以上の整数で入力してください。')
      return
    }
    const data: TransactionData = {
      type: values.type,
      date: values.date,
      amount,
      categoryId: values.type === 'transfer' ? null : values.categoryId || null,
      accountId: values.accountId,
      toAccountId: values.type === 'transfer' ? values.toAccountId || null : null,
      memo: values.memo.trim(),
      source: { kind: 'manual' },
    }
    const invalid = validateTransaction(data)
    setError(invalid)
    if (invalid) return
    setBusy(true)
    try {
      if (editingId) {
        // 自動記録や取り込みで作った記録は、変更してもどこから来たかを残す
        const existing = await store.getTransaction(editingId)
        if (existing) data.source = existing.source
      }
      await store.saveTransaction(editingId ?? store.newTransactionId(), data)
      backToList(data.date)
    } catch (caught) {
      console.error(caught)
      setError('保存できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  async function remove() {
    if (!editingId) return
    setBusy(true)
    setError(null)
    try {
      await store.deleteTransaction(editingId)
      backToList(values.date)
    } catch (caught) {
      console.error(caught)
      setError('削除できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  const title = editingId ? '記録の変更' : '記録する'

  return (
    <Layout title={title} headerEnd={<MainNav />}>
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-std-17B-170">種類</legend>
          <div className="flex flex-wrap gap-x-6">
            {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((type) => (
              <Radio key={type} name="type" value={type} size="md" checked={values.type === type} onChange={() => update('type', type)}>
                {TRANSACTION_TYPE_LABELS[type]}
              </Radio>
            ))}
          </div>
        </fieldset>

        <Field
          label="日付"
          type="date"
          required
          className="w-60"
          value={values.date}
          onChange={(event) => update('date', event.target.value)}
        />

        <Field
          label="金額（円）"
          inputMode="numeric"
          autoComplete="off"
          required
          className="w-60"
          support="数字だけを入力します（例: 1280）。"
          value={values.amount}
          onChange={(event) => update('amount', event.target.value)}
        />

        {values.type !== 'transfer' && (
          <SelectField
            label="分類"
            value={values.categoryId}
            onChange={(value) => update('categoryId', value)}
            options={kindCategories.map((category) => ({ value: category.id, label: category.name }))}
          />
        )}

        <SelectField
          label={values.type === 'transfer' ? '出金元の口座' : '口座'}
          value={values.accountId}
          onChange={(value) => update('accountId', value)}
          options={accountOptions.map((account) => ({ value: account.id, label: account.name }))}
        />

        {values.type === 'transfer' && (
          <SelectField
            label="入金先の口座"
            value={values.toAccountId}
            onChange={(value) => update('toAccountId', value)}
            options={accountOptions.map((account) => ({ value: account.id, label: account.name }))}
            support={accountOptions.length < 2 ? '振替には口座が 2 つ以上必要です。「口座」の画面で口座を足してください。' : undefined}
          />
        )}

        <Field
          label="メモ（任意）"
          autoComplete="off"
          value={values.memo}
          maxLength={200}
          onChange={(event) => update('memo', event.target.value)}
        />

        {error && <ErrorText role="alert">{error}</ErrorText>}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>
            {editingId ? '変更を保存する' : '記録する'}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => backToList(values.date)}>
            やめる
          </Button>
        </div>
      </form>

      {editingId && (
        <section aria-labelledby="other-heading" className="flex flex-col gap-4 border-t border-solid-gray-420 pt-6">
          <h2 id="other-heading" className="text-std-20B-150">ほかの操作</h2>
          <div>
            <Button type="button" variant="outline" size="md" onClick={() => navigate(`/records/new?copy=${editingId}`)}>
              この記録を写して新しく記録する
            </Button>
          </div>
          {!confirmDelete ? (
            <div>
              <Button type="button" variant="text" size="md" onClick={() => setConfirmDelete(true)}>
                この記録を削除する
              </Button>
            </div>
          ) : (
            <div role="group" aria-labelledby="delete-confirm" className="flex flex-col gap-3 rounded-8 border border-error-1 p-4">
              {/* 押したボタンが消えるので、確認の文に移って読み上げられるようにする */}
              <p
                id="delete-confirm"
                tabIndex={-1}
                ref={(element) => element?.focus()}
                className="focus:outline focus:outline-4 focus:outline-black focus:outline-offset-[calc(2/16*1rem)]"
              >
                この記録を削除します。元に戻せません。よろしいですか？
              </p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="solid-fill" size="md" aria-disabled={busy} onClick={remove}>
                  削除する
                </Button>
                <Button type="button" variant="outline" size="md" onClick={() => setConfirmDelete(false)}>
                  やめる
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </Layout>
  )
}

function SelectField({ label, value, onChange, options, support }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string, label: string }[]
  support?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-std-17B-170">
        {label}
        <span className="ml-2 text-std-16N-170 text-error-1">※必須</span>
      </label>
      {support && <p id={`${id}-support`} className="text-std-16N-170 text-solid-gray-600">{support}</p>}
      <Select
        id={id}
        className="w-full desktop:w-80"
        // required を付けると、まだ選んでいないうちから「無効」と読み上げられるため、aria-required にする
        aria-required
        aria-describedby={support ? `${id}-support` : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">選んでください</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </div>
  )
}
