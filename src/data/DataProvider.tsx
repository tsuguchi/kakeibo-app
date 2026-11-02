import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageMessage } from '../components/PageMessage'
import type { DataKeys } from '../lib/crypto/keys'
import { db } from '../lib/firebase'
import { today } from '../lib/data/ledger'
import type { RecurringRule } from '../lib/data/recurring'
import { DataStore } from '../lib/data/repository'
import type { Account, Balances, Budget, Category, ItemList } from '../lib/data/types'
import { DataContext } from './context'

// 分類・口座・残高を読み込み、どの画面からも使えるようにする。まだなければ最初の分を用意する
export function DataProvider({ uid, keys, children }: { uid: string, keys: DataKeys, children: ReactNode }) {
  const store = useMemo(() => new DataStore(db, uid, keys), [uid, keys])
  const [categories, setCategories] = useState<Category[] | null | undefined>(undefined)
  const [accounts, setAccounts] = useState<Account[] | null | undefined>(undefined)
  const [balances, setBalances] = useState<Balances | null | undefined>(undefined)
  // 予算はまだ設定していなければドキュメントがないので、空の一覧として扱う
  const [budgets, setBudgets] = useState<Budget[] | undefined>(undefined)
  const [recurring, setRecurring] = useState<RecurringRule[] | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsubscribes = [
      store.subscribeMeta<ItemList<Category>>('categories', (value) => setCategories(value?.items ?? null), setError),
      store.subscribeMeta<ItemList<Account>>('accounts', (value) => setAccounts(value?.items ?? null), setError),
      store.subscribeMeta<Balances>('balances', setBalances, setError),
      store.subscribeMeta<ItemList<Budget>>('budgets', (value) => setBudgets(value?.items ?? []), setError),
      store.subscribeMeta<ItemList<RecurringRule>>('recurring', (value) => setRecurring(value?.items ?? []), setError),
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [store])

  // 初めて開いたときは、分類と口座がまだない
  useEffect(() => {
    if (categories === null) store.ensureDefaults().catch(setError)
  }, [categories, store])

  // 開いたときと、自動記録の設定が変わったときに、日付が来た分を記録する（F-61）。
  // 作る分がなければ何も書き込まないので、設定の書き換えで繰り返し動き続けることはない
  // 残高ができる前（初めて開いた直後）には動かさない
  const ready = Boolean(balances)
  useEffect(() => {
    if (!recurring || !ready) return
    store.runRecurring(today()).catch((caught) => console.error('毎月の自動記録を作れませんでした', caught))
  }, [recurring, ready, store])

  if (error) {
    console.error(error)
    return (
      <PageMessage>
        データを読み込めませんでした。暗号化パスワードを別の端末で再設定した場合は、一度ログアウトしてから開き直してください。
      </PageMessage>
    )
  }
  if (!categories || !accounts || !balances || !budgets || !recurring) return <PageMessage>読み込み中…</PageMessage>

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  return (
    <DataContext
      value={{
        store,
        categories,
        accounts,
        balances,
        budgets,
        recurring,
        categoryName: (id) => (id && categoryNames.get(id)) || '（不明な分類）',
        accountName: (id) => (id && accountNames.get(id)) || '（不明な口座）',
      }}
    >
      {children}
    </DataContext>
  )
}
