import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PageMessage } from '../components/PageMessage'
import type { DataKeys } from '../lib/crypto/keys'
import { db } from '../lib/firebase'
import { DataStore } from '../lib/data/repository'
import type { Account, Balances, Category, ItemList } from '../lib/data/types'
import { DataContext } from './context'

// 分類・口座・残高を読み込み、どの画面からも使えるようにする。まだなければ最初の分を用意する
export function DataProvider({ uid, keys, children }: { uid: string, keys: DataKeys, children: ReactNode }) {
  const store = useMemo(() => new DataStore(db, uid, keys), [uid, keys])
  const [categories, setCategories] = useState<Category[] | null | undefined>(undefined)
  const [accounts, setAccounts] = useState<Account[] | null | undefined>(undefined)
  const [balances, setBalances] = useState<Balances | null | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsubscribes = [
      store.subscribeMeta<ItemList<Category>>('categories', (value) => setCategories(value?.items ?? null), setError),
      store.subscribeMeta<ItemList<Account>>('accounts', (value) => setAccounts(value?.items ?? null), setError),
      store.subscribeMeta<Balances>('balances', setBalances, setError),
    ]
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [store])

  // 初めて開いたときは、分類と口座がまだない
  useEffect(() => {
    if (categories === null) store.ensureDefaults().catch(setError)
  }, [categories, store])

  if (error) {
    console.error(error)
    return (
      <PageMessage>
        データを読み込めませんでした。暗号化パスワードを別の端末で再設定した場合は、一度ログアウトしてから開き直してください。
      </PageMessage>
    )
  }
  if (!categories || !accounts || !balances) return <PageMessage>読み込み中…</PageMessage>

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]))
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]))

  return (
    <DataContext
      value={{
        store,
        categories,
        accounts,
        balances,
        categoryName: (id) => (id && categoryNames.get(id)) || '（不明な分類）',
        accountName: (id) => (id && accountNames.get(id)) || '（不明な口座）',
      }}
    >
      {children}
    </DataContext>
  )
}
