import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/dads/Button'
import { Checkbox } from '../components/dads/Checkbox'
import { ErrorText } from '../components/dads/ErrorText'
import { Radio } from '../components/dads/Radio'
import { Select } from '../components/dads/Select'
import { Field } from '../components/Field'
import { focusOnMount } from '../components/focusOnMount'
import { Layout, MainNav } from '../components/Layout'
import { SelectField } from '../components/SelectField'
import { useData } from '../data/context'
import {
  buildImportRows,
  decodeCsv,
  detectEncoding,
  exportRows,
  findDuplicates,
  guessMapping,
  isExportFormat,
  parseCsv,
  parseExportRows,
  SIMILAR_DAYS,
  toCsv,
  type ColumnMapping,
  type CsvEncoding,
  type DuplicateMatch,
} from '../lib/data/csv'
import { formatMonth, formatYen, monthOf, shiftMonth, today } from '../lib/data/ledger'
import type { Transaction, TransactionData } from '../lib/data/types'
import { amountLabel } from './records/amount'

const CHUNK = 50

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = []
  for (let month = from; month <= to && months.length < 240; month = shiftMonth(month, 1)) months.push(month)
  return months
}

// CSV の書き出し・取り込み（F-70〜F-74）
export function CsvPage() {
  return (
    <Layout title="CSV の書き出し・取り込み" headerEnd={<MainNav />}>
      <ExportSection />
      <ImportSection />
    </Layout>
  )
}

function ExportSection() {
  const { store, categoryName, accountName } = useData()
  const thisMonth = monthOf(today())
  const [from, setFrom] = useState(`${thisMonth.slice(0, 4)}-01`)
  const [to, setTo] = useState(thisMonth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (!from || !to || from > to) {
      setError('期間の始まりと終わりを正しく入力してください。')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const transactions = (await Promise.all(monthsBetween(from, to).map((month) => store.getMonth(month)))).flat()
      const blob = new Blob([toCsv(exportRows(transactions, categoryName, accountName))], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `kakeibo_${from}_${to}.csv`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`${formatMonth(from)}〜${formatMonth(to)}の記録 ${transactions.length} 件を書き出しました。`)
    } catch (caught) {
      console.error(caught)
      setError('書き出せませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="export-heading" className="flex flex-col gap-4">
      <h2 id="export-heading" className="text-std-20B-150">書き出し</h2>
      <p>選んだ期間の記録を CSV ファイルに保存します。Excel などの表計算ソフトで開けます。</p>
      <p className="text-dns-14N-130 text-solid-gray-600">
        書き出したファイルは暗号化されていません。保存する場所と、ほかの人に渡すときに気をつけてください。
      </p>
      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <div className="flex flex-wrap gap-6">
          <Field label="期間の始まり" type="month" required className="w-60" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Field label="期間の終わり" type="month" required className="w-60" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        {error && <ErrorText role="alert">{error}</ErrorText>}
        {message && <p role="status">{message}</p>}
        <div>
          <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>{busy ? '書き出しています…' : '書き出す'}</Button>
        </div>
      </form>
    </section>
  )
}

interface PreviewRow {
  key: string
  line: number
  data: TransactionData | null
  problem: string | null
  duplicate: DuplicateMatch | null
  include: boolean
}

type Loaded = { name: string, bytes: Uint8Array, encoding: CsvEncoding, rows: string[][] }

function ImportSection() {
  const { store, categories, accounts, categoryName, accountName } = useData()
  const fileId = useId()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [accountId, setAccountId] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [incomeCategory, setIncomeCategory] = useState('')
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const ownFormat = loaded ? isExportFormat(loaded.rows[0]) : false
  const visibleAccounts = accounts.filter((account) => !account.hidden).map((account) => ({ value: account.id, label: account.name }))
  const categoryOptions = (kind: 'income' | 'expense') =>
    categories.filter((category) => category.kind === kind && !category.hidden).sort((a, b) => a.order - b.order).map((category) => ({ value: category.id, label: category.name }))

  function reset() {
    setLoaded(null)
    setMapping(null)
    setPreview(null)
    setError(null)
  }

  async function chooseFile(file: File | undefined) {
    reset()
    setMessage(null)
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('ファイルが大きすぎます（5MB まで）。期間を区切って取り込んでください。')
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const encoding = detectEncoding(bytes)
    load(file.name, bytes, encoding)
  }

  function load(name: string, bytes: Uint8Array, encoding: CsvEncoding) {
    const rows = parseCsv(decodeCsv(bytes, encoding))
    if (rows.length === 0) {
      setError('ファイルの中に行がありません。')
      return
    }
    setLoaded({ name, bytes, encoding, rows })
    setMapping(guessMapping(rows[0]))
    setPreview(null)
  }

  async function buildPreview() {
    if (!loaded || !mapping) return
    setError(null)
    let rows: { line: number, data: TransactionData | null, problem: string | null }[]
    if (ownFormat) {
      rows = parseExportRows(loaded.rows, categories, accounts)
    } else {
      if (!accountId) {
        setError('取り込み先の口座を選んでください。')
        return
      }
      if (!expenseCategory || !incomeCategory) {
        setError('支出と収入の分類を選んでください（あとで 1 件ずつ変えられます）。')
        return
      }
      rows = buildImportRows(loaded.rows, mapping).map((row) => ({
        line: row.line,
        problem: row.problem,
        data: row.problem
          ? null
          : {
              type: row.type!,
              date: row.date!,
              amount: row.amount!,
              categoryId: row.type === 'income' ? incomeCategory : expenseCategory,
              accountId,
              toAccountId: null,
              memo: row.memo,
              source: { kind: 'import' },
            },
      }))
    }

    // 重複を見分けるため、明細の日付の前後 3 日を含む月の記録を読む（F-74）
    setBusy(true)
    try {
      const dates = rows.flatMap((row) => (row.data ? [row.data.date] : [])).sort()
      let existing: Transaction[] = []
      if (dates.length > 0) {
        const pad = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 7)
        existing = (await Promise.all(monthsBetween(pad(dates[0], -SIMILAR_DAYS), pad(dates.at(-1)!, SIMILAR_DAYS)).map((month) => store.getMonth(month)))).flat()
      }
      const matches = new Map<number, DuplicateMatch>()
      const groups = new Map<string, number[]>()
      rows.forEach((row, index) => {
        if (!row.data || row.data.type === 'transfer') return
        groups.set(row.data.accountId, [...(groups.get(row.data.accountId) ?? []), index])
      })
      for (const [groupAccount, indexes] of groups) {
        const found = findDuplicates(indexes.map((index) => rows[index].data as TransactionData & { type: 'income' | 'expense' }), existing, groupAccount)
        found.forEach((match, i) => match && matches.set(indexes[i], match))
      }
      // 振替（このアプリの形式だけにある）は、日付・金額・口座・メモがすべて同じものだけを「同じ記録」とする
      const usedTransfers = new Set<string>()
      rows.forEach((row, index) => {
        const data = row.data
        if (!data || data.type !== 'transfer') return
        const same = existing.find((tx) => tx.type === 'transfer' && !usedTransfers.has(tx.id) && tx.date === data.date && tx.amount === data.amount
          && tx.accountId === data.accountId && tx.toAccountId === data.toAccountId && tx.memo === data.memo)
        if (same) {
          usedTransfers.add(same.id)
          matches.set(index, { kind: 'same', existing: same })
        }
      })
      setPreview(rows.map((row, index) => ({
        key: `${row.line}`,
        line: row.line,
        data: row.data,
        problem: row.problem,
        duplicate: matches.get(index) ?? null,
        include: !!row.data && !matches.has(index),
      })))
    } catch (caught) {
      console.error(caught)
      setError('今の記録を読み込めませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview) return
    const items = preview.filter((row) => row.include && row.data).map((row) => row.data!)
    if (items.length === 0) {
      setError('取り込む行がありません。')
      return
    }
    setBusy(true)
    setError(null)
    let done = 0
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        await store.addTransactions(items.slice(i, i + CHUNK))
        done += Math.min(CHUNK, items.length - i)
        setProgress(`${done} / ${items.length} 件を取り込みました…`)
      }
      setMessage(`${items.length} 件を取り込みました。`)
      reset()
    } catch (caught) {
      console.error(caught)
      setError(`途中で止まりました（${done} 件まで取り込み済み）。インターネットの接続を確かめてください。続きは、同じファイルをもう一度選ぶと、取り込み済みの分が「同じ記録がある」と表示されます。`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  function updateRow(key: string, change: (row: PreviewRow) => PreviewRow) {
    setPreview((rows) => rows && rows.map((row) => (row.key === key ? change(row) : row)))
  }

  const header = loaded?.rows[0] ?? []
  const columnOptions = (allowNone: boolean) => [
    ...(allowNone ? [{ value: '-1', label: '使わない' }] : []),
    ...header.map((cell, index) => ({ value: String(index), label: mapping?.hasHeader ? `${index + 1} 列目（${cell || '見出しなし'}）` : `${index + 1} 列目（例: ${cell}）` })),
  ]
  const included = preview?.filter((row) => row.include).length ?? 0
  const duplicates = preview?.filter((row) => row.duplicate).length ?? 0
  const problems = preview?.filter((row) => row.problem).length ?? 0

  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-4">
      <h2 id="import-heading" className="text-std-20B-150">取り込み</h2>
      <p>このアプリで書き出した CSV と、銀行やカード会社の明細の CSV を取り込めます。取り込む前に、内容を確かめられます。</p>

      <div className="flex flex-col gap-2">
        <label htmlFor={fileId} className="text-std-17B-170">CSV ファイル</label>
        <input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          className="text-std-16N-170 file:mr-4 file:rounded-8 file:border file:border-solid file:border-key-900 file:bg-white file:px-4 file:py-2 file:text-dns-16B-130 file:text-key-900 hover:file:bg-key-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
      </div>
      {message && <p role="status">{message}</p>}

      {loaded && mapping && (
        <div className="flex flex-col gap-6 rounded-8 border border-solid-gray-420 p-4">
          <p className="text-std-16B-170">{loaded.name}（{loaded.rows.length} 行・{ownFormat ? 'このアプリの形式' : '明細の形式'}）</p>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-std-17B-170">文字コード</legend>
            <p className="text-dns-14N-130 text-solid-gray-600">文字化けしているときは、もう一方を選んでください。</p>
            <div className="flex flex-wrap gap-x-6">
              {(['utf-8', 'shift_jis'] as CsvEncoding[]).map((encoding) => (
                <Radio key={encoding} name="encoding" value={encoding} size="md" checked={loaded.encoding === encoding} onChange={() => load(loaded.name, loaded.bytes, encoding)}>
                  {encoding === 'utf-8' ? 'UTF-8' : 'Shift_JIS'}
                </Radio>
              ))}
            </div>
          </fieldset>

          {!ownFormat && (
            <>
              <div className="flex flex-col gap-2">
                <p className="text-std-17B-170">ファイルの最初の行</p>
                <p className="whitespace-pre-wrap break-all rounded-8 bg-solid-gray-50 p-3 text-mono-14N-150">{loaded.rows.slice(0, 2).map((row) => row.join(', ')).join('\n')}</p>
              </div>
              <Checkbox checked={mapping.hasHeader} size="md" onChange={(event) => setMapping({ ...mapping, hasHeader: event.target.checked })}>
                1 行目は見出し（取り込まない）
              </Checkbox>
              <ColumnSelect label="日付の列" value={mapping.date} options={columnOptions(false)} onChange={(date) => setMapping({ ...mapping, date })} />
              <fieldset className="flex flex-col gap-1">
                <legend className="text-std-17B-170">金額の列</legend>
                <div className="flex flex-wrap gap-x-6">
                  <Radio name="amountMode" value="single" size="md" checked={mapping.amountMode === 'single'} onChange={() => setMapping({ ...mapping, amountMode: 'single' })}>1 つの列</Radio>
                  <Radio name="amountMode" value="split" size="md" checked={mapping.amountMode === 'split'} onChange={() => setMapping({ ...mapping, amountMode: 'split' })}>出金と入金が別の列</Radio>
                </div>
              </fieldset>
              {mapping.amountMode === 'single' ? (
                <>
                  <ColumnSelect label="金額の列" value={mapping.amount} options={columnOptions(false)} onChange={(amount) => setMapping({ ...mapping, amount })} />
                  <Checkbox checked={mapping.positiveIsExpense} size="md" onChange={(event) => setMapping({ ...mapping, positiveIsExpense: event.target.checked })}>
                    プラスの金額を支出として取り込む（カードの明細など）
                  </Checkbox>
                </>
              ) : (
                <>
                  <ColumnSelect label="出金（支出）の列" value={mapping.withdrawal} options={columnOptions(false)} onChange={(withdrawal) => setMapping({ ...mapping, withdrawal })} />
                  <ColumnSelect label="入金（収入）の列" value={mapping.deposit} options={columnOptions(false)} onChange={(deposit) => setMapping({ ...mapping, deposit })} />
                </>
              )}
              <ColumnSelect label="内容（メモ）の列" value={mapping.memo} options={columnOptions(true)} onChange={(memo) => setMapping({ ...mapping, memo })} />
              <SelectField label="取り込み先の口座" value={accountId} onChange={setAccountId} options={visibleAccounts} />
              <SelectField label="支出の分類（まとめて指定）" value={expenseCategory} onChange={setExpenseCategory} options={categoryOptions('expense')} />
              <SelectField label="収入の分類（まとめて指定）" value={incomeCategory} onChange={setIncomeCategory} options={categoryOptions('income')} />
            </>
          )}

          {ownFormat && <p>分類と口座は、名前が同じものに取り込みます。見つからない行は取り込みません。</p>}
          {error && !preview && <ErrorText role="alert">{error}</ErrorText>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="solid-fill" size="lg" aria-disabled={busy} onClick={buildPreview}>
              {busy && !preview ? '確かめています…' : '取り込む内容を確かめる'}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={reset}>やめる</Button>
          </div>
        </div>
      )}

      {preview && (
        <section aria-labelledby="preview-heading" className="flex flex-col gap-4">
          {/* 確認の表はページの下の方に出るので、見出しに移って読み上げと画面の位置を合わせる */}
          <h3
            id="preview-heading"
            tabIndex={-1}
            ref={focusOnMount}
            className="text-std-18B-160 focus:outline focus:outline-4 focus:outline-black focus:outline-offset-[calc(2/16*1rem)]"
          >
            取り込む内容の確認
          </h3>
          <p>
            {preview.length} 行のうち、{included} 件を取り込みます。
            {duplicates > 0 && `すでにある記録と重なっていそうな行が ${duplicates} 件あり、最初は取り込まない設定にしています。`}
            {problems > 0 && `読み取れない行が ${problems} 件あります。`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-dns-14N-130">
              <thead>
                <tr className="border-b border-solid-gray-420 text-left text-solid-gray-600">
                  <th scope="col" className="py-2 pr-2 font-normal">取り込む</th>
                  <th scope="col" className="py-2 pr-2 font-normal">日付・内容</th>
                  <th scope="col" className="py-2 pr-2 text-right font-normal">金額</th>
                  <th scope="col" className="py-2 pr-2 font-normal">分類</th>
                  <th scope="col" className="py-2 font-normal">確認</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.key} className="border-b border-solid-gray-200 align-top">
                    <td className="py-2 pr-2">
                      <Checkbox
                        checked={row.include}
                        disabled={!row.data}
                        aria-label={`${row.line} 行目を取り込む`}
                        onChange={(event) => updateRow(row.key, (current) => ({ ...current, include: event.target.checked }))}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <span className="block">{row.data?.date ?? `${row.line} 行目`}</span>
                      <span className="block text-solid-gray-600">{row.data ? (row.data.memo || (row.data.type === 'transfer' ? `${accountName(row.data.accountId)} → ${accountName(row.data.toAccountId)}` : '')) : ''}</span>
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{row.data ? amountLabel(row.data) : ''}</td>
                    <td className="py-2 pr-2">
                      {row.data && row.data.type !== 'transfer' && !ownFormat ? (
                        <Select
                          blockSize="sm"
                          aria-label={`${row.line} 行目の分類`}
                          value={row.data.categoryId ?? ''}
                          onChange={(event) => updateRow(row.key, (current) => ({ ...current, data: { ...current.data!, categoryId: event.target.value } }))}
                        >
                          {categoryOptions(row.data.type).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </Select>
                      ) : row.data && row.data.type !== 'transfer' ? categoryName(row.data.categoryId) : row.data ? '振替' : ''}
                    </td>
                    <td className="py-2">
                      {row.problem && <span className="font-bold text-error-1">{row.problem}</span>}
                      {row.duplicate && (
                        <span className="block">
                          <span className="font-bold">{row.duplicate.kind === 'same' ? '同じ記録があります' : '似た記録があります'}</span>
                          <span className="block text-solid-gray-600">
                            {row.duplicate.existing.date}・{row.duplicate.existing.type === 'transfer' ? '振替' : categoryName(row.duplicate.existing.categoryId)}・{formatYen(row.duplicate.existing.amount)}
                            {row.duplicate.existing.memo && `・${row.duplicate.existing.memo}`}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <ErrorText role="alert">{error}</ErrorText>}
          {progress && <p role="status">{progress}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="solid-fill" size="lg" aria-disabled={busy || included === 0} onClick={runImport}>
              {included} 件を取り込む
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={() => setPreview(null)}>設定に戻る</Button>
          </div>
        </section>
      )}
    </section>
  )
}

function ColumnSelect({ label, value, options, onChange }: { label: string, value: number, options: { value: string, label: string }[], onChange: (value: number) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-std-17B-170">{label}</label>
      <Select id={id} className="w-full desktop:w-96" value={String(value)} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </div>
  )
}
