import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/dads/Button'
import { ErrorText } from '../components/dads/ErrorText'
import { Select } from '../components/dads/Select'
import { Field } from '../components/Field'
import { Layout, MainNav } from '../components/Layout'
import { ManageList } from '../components/ManageList'
import { useData } from '../data/context'
import { newId } from '../lib/data/defaults'
import { formatYen, MAX_AMOUNT, moveItem } from '../lib/data/ledger'
import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from '../lib/data/types'

// 使い始めの残高はマイナスもあり得る（クレジットカードの未払い分など）
function parseSignedAmount(text: string): number | null {
  const normalized = text.normalize('NFKC').replace(/[,\s円]/g, '').replace(/^[−ー]/, '-')
  if (normalized === '') return 0
  if (!/^-?\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return Math.abs(amount) <= MAX_AMOUNT ? amount : null
}

// 口座ごとの残高の一覧と、口座の追加（F-30、F-31）
export function AccountsPage() {
  const { store, accounts, balances } = useData()
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('bank')
  const [opening, setOpening] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const typeId = useId()

  const visible = accounts.filter((account) => !account.hidden).sort((a, b) => a.order - b.order)
  const total = visible.reduce((sum, account) => sum + (balances[account.id] ?? 0), 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const trimmed = name.trim()
    const openingBalance = parseSignedAmount(opening)
    if (!trimmed) {
      setError('口座の名前を入力してください。')
      return
    }
    if (openingBalance === null) {
      setError('使い始めの残高は整数で入力してください（マイナスのときは先頭に「-」）。')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await store.addAccount({ id: newId(), type, name: trimmed, openingBalance, order: 0, hidden: false })
      setName('')
      setOpening('')
      setMessage(`「${trimmed}」を追加しました。`)
    } catch (caught) {
      console.error(caught)
      setError('追加できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="口座" headerEnd={<MainNav />}>
      <section aria-labelledby="balances-heading" className="flex flex-col gap-3">
        <h2 id="balances-heading" className="text-std-20B-150">今の残高</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-solid-gray-420 text-left text-dns-14N-130 text-solid-gray-600">
              <th scope="col" className="py-2 font-normal">口座</th>
              <th scope="col" className="py-2 font-normal">種類</th>
              <th scope="col" className="py-2 text-right font-normal">残高</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((account) => {
              const balance = balances[account.id] ?? 0
              return (
                <tr key={account.id} className="border-b border-solid-gray-200">
                  <th scope="row" className="py-3 text-left text-std-16B-170">{account.name}</th>
                  <td className="py-3 text-dns-14N-130 text-solid-gray-600">{ACCOUNT_TYPE_LABELS[account.type]}</td>
                  <td className={`py-3 text-right text-dns-17B-130 ${balance < 0 ? 'text-error-1' : ''}`}>
                    {balance < 0 ? '−' : ''}{formatYen(Math.abs(balance))}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="py-3 text-left text-std-16B-170">合計</th>
              <td className={`py-3 text-right text-dns-17B-130 ${total < 0 ? 'text-error-1' : ''}`}>
                {total < 0 ? '−' : ''}{formatYen(Math.abs(total))}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="text-dns-14N-130 text-solid-gray-600">クレジットカードは、まだ払っていない金額をマイナスで表します。</p>
      </section>

      <section aria-labelledby="manage-heading" className="flex flex-col gap-4">
        <h2 id="manage-heading" className="text-std-20B-150">口座の管理</h2>
        <ManageList
          label="口座の一覧"
          items={accounts}
          describe={(account) => `${ACCOUNT_TYPE_LABELS[account.type]}・使い始めの残高 ${formatSigned(account.openingBalance)}`}
          onMove={(id, delta) => store.updateAccounts((items) => moveItem(items, id, delta, (a, b) => a.hidden === b.hidden))}
          onToggleHidden={(id) => store.updateAccounts((items) => items.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)))}
          renderEditor={(account, close) => <AccountEditor account={account} onDone={close} />}
        />
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-4">
        <h2 id="add-heading" className="text-std-20B-150">口座を追加する</h2>
        <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
          <Field label="名前" required autoComplete="off" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex flex-col gap-2">
            <label htmlFor={typeId} className="text-std-17B-170">種類</label>
            <Select id={typeId} className="w-full desktop:w-80" value={type} onChange={(event) => setType(event.target.value as AccountType)}>
              {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((value) => (
                <option key={value} value={value}>{ACCOUNT_TYPE_LABELS[value]}</option>
              ))}
            </Select>
          </div>
          <Field
            label="使い始めの残高（円）"
            inputMode="numeric"
            autoComplete="off"
            className="w-60"
            support="空欄なら 0 円。クレジットカードの未払い分などは、先頭に「-」を付けます。"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
          />
          {error && <ErrorText role="alert">{error}</ErrorText>}
          {message && <p role="status">{message}</p>}
          <div>
            <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>追加する</Button>
          </div>
        </form>
      </section>
    </Layout>
  )
}

function formatSigned(amount: number): string {
  return `${amount < 0 ? '−' : ''}${formatYen(Math.abs(amount))}`
}

// 口座の名前・種類・使い始めの残高の変更（F-32）。使い始めの残高を変えると、今の残高も同じだけ変わる
function AccountEditor({ account, onDone }: { account: Account, onDone: () => void }) {
  const { store } = useData()
  const [name, setName] = useState(account.name)
  const [type, setType] = useState<AccountType>(account.type)
  const [opening, setOpening] = useState(String(account.openingBalance))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typeId = useId()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    const openingBalance = parseSignedAmount(opening)
    if (!trimmed) {
      setError('口座の名前を入力してください。')
      return
    }
    if (openingBalance === null) {
      setError('使い始めの残高は整数で入力してください（マイナスのときは先頭に「-」）。')
      return
    }
    setBusy(true)
    try {
      await store.updateAccounts((items) => items.map((item) => (item.id === account.id ? { ...item, name: trimmed, type, openingBalance } : item)))
      onDone()
    } catch (caught) {
      console.error(caught)
      setError('変更できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-label={`「${account.name}」の変更`}>
      <Field label="名前" required maxLength={40} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      <div className="flex flex-col gap-2">
        <label htmlFor={typeId} className="text-std-17B-170">種類</label>
        <Select id={typeId} className="w-full desktop:w-80" value={type} onChange={(event) => setType(event.target.value as AccountType)}>
          {(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((value) => (
            <option key={value} value={value}>{ACCOUNT_TYPE_LABELS[value]}</option>
          ))}
        </Select>
      </div>
      <Field
        label="使い始めの残高（円）"
        inputMode="numeric"
        autoComplete="off"
        className="w-60"
        support="変えると、今の残高も同じ金額だけ変わります。"
        value={opening}
        onChange={(event) => setOpening(event.target.value)}
      />
      {error && <ErrorText role="alert">{error}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid-fill" size="md" aria-disabled={busy}>保存する</Button>
        <Button type="button" variant="outline" size="md" onClick={onDone}>やめる</Button>
      </div>
    </form>
  )
}
