// DataStore（記録の読み書き）を、Emulator の本物の Security Rules に対して動かす
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createKeys, type DataKeys } from '../../src/lib/crypto/keys'
import type { RecurringRule } from '../../src/lib/data/recurring'
import { DataStore } from '../../src/lib/data/repository'
import type { Account, Balances, Category, ItemList, Summary, Transaction, TransactionData } from '../../src/lib/data/types'

let env: RulesTestEnvironment
let keys: DataKeys

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kakeibo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
  ;({ keys } = await createKeys('repository test password', { name: 'argon2id', m: 256, t: 1, p: 1 }))
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

function storeFor(uid: string): { store: DataStore, db: Firestore } {
  const db = env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore() as unknown as Firestore
  return { store: new DataStore(db, uid, keys), db }
}

// 見張りの最初の値を 1 回だけ受け取る
function first<T>(subscribe: (onChange: (value: T) => void, onError: (error: Error) => void) => () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribe((value) => {
      setTimeout(() => unsubscribe())
      resolve(value)
    }, reject)
  })
}

async function setup(store: DataStore) {
  await store.ensureDefaults()
  const categories = (await first<ItemList<Category> | null>((ok, ng) => store.subscribeMeta('categories', ok, ng)))!.items
  const accounts = (await first<ItemList<Account> | null>((ok, ng) => store.subscribeMeta('accounts', ok, ng)))!.items
  return { food: categories.find((c) => c.name === '食費')!.id, salary: categories.find((c) => c.name === '給与')!.id, cash: accounts[0].id }
}

// 書き込んだ後の値を確かめるときは、ブラウザ内の控え（キャッシュ）を持たない新しい接続で読む
const fresh = () => storeFor('alice').store
const balancesOf = () => first<Balances | null>((ok, ng) => fresh().subscribeMeta('balances', ok, ng))
const summaryOf = (month: string) => first<Summary>((ok, ng) => fresh().subscribeSummary(month, ok, ng))
const monthOf = (month: string) => first<Transaction[]>((ok, ng) => fresh().subscribeMonth(month, ok, ng))

function data(overrides: Partial<TransactionData>): TransactionData {
  return { type: 'expense', date: '2026-11-02', amount: 1000, categoryId: null, accountId: '', toAccountId: null, memo: '', source: { kind: 'manual' }, ...overrides }
}

describe('DataStore', () => {
  test('最初の分類と口座を 1 回だけ用意する', async () => {
    const { store } = storeFor('alice')
    await store.ensureDefaults()
    await store.ensureDefaults()
    const categories = await first<ItemList<Category> | null>((ok, ng) => store.subscribeMeta('categories', ok, ng))
    const accounts = await first<ItemList<Account> | null>((ok, ng) => store.subscribeMeta('accounts', ok, ng))
    expect(categories!.items.filter((c) => c.kind === 'expense').map((c) => c.name)).toContain('食費')
    expect(accounts!.items.map((a) => a.name)).toEqual(['現金'])
  })

  test('記録の追加・変更・削除で、集計と残高も一緒に変わる', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    const id = store.newTransactionId()

    await store.saveTransaction(id, data({ amount: 1200, categoryId: ids.food, accountId: ids.cash, memo: 'スーパー' }))
    await store.saveTransaction(store.newTransactionId(), data({ type: 'income', amount: 250000, categoryId: ids.salary, accountId: ids.cash }))
    expect(await summaryOf('2026-11')).toEqual({ income: 250000, expense: 1200, byCategory: { [ids.food]: 1200, [ids.salary]: 250000 } })
    expect((await balancesOf())![ids.cash]).toBe(248800)

    // 金額と月を変える
    await store.saveTransaction(id, data({ date: '2026-10-31', amount: 1500, categoryId: ids.food, accountId: ids.cash, memo: 'スーパー' }))
    expect((await summaryOf('2026-11')).expense).toBe(0)
    expect((await summaryOf('2026-10')).expense).toBe(1500)
    expect((await balancesOf())![ids.cash]).toBe(248500)
    expect((await monthOf('2026-10')).map((tx) => tx.memo)).toEqual(['スーパー'])

    await store.deleteTransaction(id)
    expect((await summaryOf('2026-10')).expense).toBe(0)
    expect((await balancesOf())![ids.cash]).toBe(250000)
    expect(await store.getTransaction(id)).toBeNull()
  })

  test('振替は残高だけを動かす', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    const bank: Account = { id: 'bank1', type: 'bank', name: '銀行', openingBalance: 100000, order: 0, hidden: false }
    await store.addAccount(bank)
    await store.saveTransaction(store.newTransactionId(), data({ type: 'transfer', amount: 30000, accountId: 'bank1', toAccountId: ids.cash }))
    expect(await balancesOf()).toEqual({ [ids.cash]: 30000, bank1: 70000 })
    expect(await summaryOf('2026-11')).toEqual({ income: 0, expense: 0, byCategory: {} })
  })

  test('保存されたデータは暗号化されていて、金額やメモは平文で残らない', async () => {
    const { store, db } = storeFor('alice')
    const ids = await setup(store)
    const id = store.newTransactionId()
    await store.saveTransaction(id, data({ amount: 98765, categoryId: ids.food, accountId: ids.cash, memo: 'ひみつのメモ' }))
    const raw = (await getDoc(doc(db, 'users/alice/transactions', id))).data()!
    expect(Object.keys(raw).sort()).toEqual(['createdAt', 'enc', 'month', 'updatedAt'])
    const serialized = JSON.stringify(raw)
    expect(serialized).not.toContain('98765')
    expect(serialized).not.toContain('ひみつ')
  })

  test('口座の使い始めの残高を変えると、今の残高も同じだけ変わる', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await store.saveTransaction(store.newTransactionId(), data({ amount: 800, categoryId: ids.food, accountId: ids.cash }))
    await store.updateAccounts((items) => items.map((item) => (item.id === ids.cash ? { ...item, name: 'さいふ', openingBalance: 5000 } : item)))
    expect((await balancesOf())![ids.cash]).toBe(4200)
    const accounts = await first<ItemList<Account> | null>((ok, ng) => fresh().subscribeMeta('accounts', ok, ng))
    expect(accounts!.items[0]).toMatchObject({ name: 'さいふ', openingBalance: 5000 })
  })

  test('予算と分類を変えられる', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await store.updateBudgets((items) => [...items, { categoryId: ids.food, fromMonth: '2026-11', amount: 30000 }])
    await store.updateCategories((items) => items.map((item) => (item.id === ids.food ? { ...item, hidden: true } : item)))
    const budgets = await first<ItemList<{ amount: number }> | null>((ok, ng) => fresh().subscribeMeta('budgets', ok, ng))
    const categories = await first<ItemList<Category> | null>((ok, ng) => fresh().subscribeMeta('categories', ok, ng))
    expect(budgets!.items[0].amount).toBe(30000)
    expect(categories!.items.find((c) => c.id === ids.food)!.hidden).toBe(true)
  })

  test('毎月の自動記録: 日付が来た分を 1 回だけ作り、消した分は作り直さない', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    const rent: RecurringRule = {
      id: 'rent', type: 'expense', day: 25, amount: 85000, categoryId: ids.food, accountId: ids.cash, toAccountId: null,
      memo: '家賃', startMonth: '2026-09', endMonth: null, shift: 'next', active: true, generatedThrough: '2026-08',
    }
    await store.updateRecurring(() => [rent])

    // 2026-10-25 は日曜なので 10-26 に移る。11-02 時点では 9 月分と 10 月分の 2 件
    expect(await store.runRecurring('2026-11-02')).toBe(2)
    expect(await store.runRecurring('2026-11-02')).toBe(0)
    const october = await monthOf('2026-10')
    expect(october.map((tx) => [tx.date, tx.source.originalDate, tx.source.kind])).toEqual([['2026-10-26', '2026-10-25', 'recurring']])
    expect((await summaryOf('2026-09')).expense).toBe(85000)
    expect((await balancesOf())![ids.cash]).toBe(-170000)

    // 自動で作った分を消しても、作り直さない
    await store.deleteTransaction(october[0].id)
    expect(await store.runRecurring('2026-11-03')).toBe(0)
    expect(await monthOf('2026-10')).toEqual([])
    const rules = await first<ItemList<RecurringRule> | null>((ok, ng) => fresh().subscribeMeta('recurring', ok, ng))
    expect(rules!.items[0].generatedThrough).toBe('2026-10')
  })

  test('毎月の自動記録: 2 台で同時に動かしても二重にならない', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await store.updateRecurring(() => [{
      id: 'sub', type: 'expense', day: 1, amount: 990, categoryId: ids.food, accountId: ids.cash, toAccountId: null,
      memo: 'サブスク', startMonth: '2026-06', endMonth: null, shift: 'none', active: true, generatedThrough: '2026-05',
    }])
    const other = storeFor('alice').store
    const created = await Promise.all([store.runRecurring('2026-11-02'), other.runRecurring('2026-11-02')])
    expect(created[0] + created[1]).toBe(6)
    const counts = await Promise.all(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((m) => monthOf(m).then((txs) => txs.length)))
    expect(counts).toEqual([1, 1, 1, 1, 1, 1])
    expect((await balancesOf())![ids.cash]).toBe(-5940)
  })

  test('取り込んだ記録をまとめて保存し、集計と残高も更新する', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await store.addTransactions([
      data({ date: '2026-10-30', amount: 1200, categoryId: ids.food, accountId: ids.cash, source: { kind: 'import' } }),
      data({ date: '2026-11-01', amount: 800, categoryId: ids.food, accountId: ids.cash, source: { kind: 'import' } }),
      data({ type: 'income', date: '2026-11-01', amount: 5000, categoryId: ids.salary, accountId: ids.cash, source: { kind: 'import' } }),
    ])
    expect((await summaryOf('2026-10')).expense).toBe(1200)
    expect(await summaryOf('2026-11')).toMatchObject({ income: 5000, expense: 800 })
    expect((await balancesOf())![ids.cash]).toBe(3000)
    expect((await store.getMonth('2026-11')).map((tx) => tx.source.kind)).toEqual(['import', 'import'])
    await expect(store.addTransactions([data({ accountId: ids.cash })])).rejects.toThrow('分類を選んでください。')
  })

  test('正しくない記録は保存しない', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await expect(store.saveTransaction(store.newTransactionId(), data({ accountId: ids.cash }))).rejects.toThrow('分類を選んでください。')
  })
})
