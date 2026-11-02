// DataStore（記録の読み書き）を、Emulator の本物の Security Rules に対して動かす
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createKeys, type DataKeys } from '../../src/lib/crypto/keys'
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

  test('正しくない記録は保存しない', async () => {
    const { store } = storeFor('alice')
    const ids = await setup(store)
    await expect(store.saveTransaction(store.newTransactionId(), data({ accountId: ids.cash }))).rejects.toThrow('分類を選んでください。')
  })
})
