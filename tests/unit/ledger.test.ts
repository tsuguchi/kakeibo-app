import { describe, expect, test } from 'vitest'
import {
  applyToBalances,
  budgetFor,
  moveItem,
  setBudget,
  applyToSummary,
  emptySummary,
  formatMonth,
  isValidDate,
  parseAmount,
  shiftMonth,
  validateTransaction,
} from '../../src/lib/data/ledger'
import type { TransactionData } from '../../src/lib/data/types'

function tx(overrides: Partial<TransactionData> = {}): TransactionData {
  return {
    type: 'expense',
    date: '2026-11-02',
    amount: 1000,
    categoryId: 'food',
    accountId: 'cash',
    toAccountId: null,
    memo: '',
    source: { kind: 'manual' },
    ...overrides,
  }
}

describe('月ごとの集計', () => {
  test('支出と収入を分類ごとに足す', () => {
    let summary = applyToSummary(emptySummary(), tx(), 1)
    summary = applyToSummary(summary, tx({ amount: 500 }), 1)
    summary = applyToSummary(summary, tx({ type: 'income', amount: 300000, categoryId: 'salary' }), 1)
    expect(summary).toEqual({ income: 300000, expense: 1500, byCategory: { food: 1500, salary: 300000 } })
  })

  test('振替は集計に含めない', () => {
    const summary = applyToSummary(emptySummary(), tx({ type: 'transfer', categoryId: null, toAccountId: 'bank' }), 1)
    expect(summary).toEqual(emptySummary())
  })

  test('足して引くと元に戻り、0 になった分類は消える', () => {
    const summary = applyToSummary(applyToSummary(emptySummary(), tx(), 1), tx(), -1)
    expect(summary).toEqual(emptySummary())
  })

  test('元の集計を書き換えない', () => {
    const original = emptySummary()
    applyToSummary(original, tx(), 1)
    expect(original).toEqual(emptySummary())
  })
})

describe('口座の残高', () => {
  test('収入は増え、支出は減る', () => {
    let balances = applyToBalances({ cash: 10000 }, tx({ amount: 3000 }), 1)
    balances = applyToBalances(balances, tx({ type: 'income', amount: 500 }), 1)
    expect(balances).toEqual({ cash: 7500 })
  })

  test('振替は出金元が減り、入金先が増える', () => {
    const balances = applyToBalances({ bank: 50000, cash: 0 }, tx({ type: 'transfer', amount: 20000, accountId: 'bank', toAccountId: 'cash', categoryId: null }), 1)
    expect(balances).toEqual({ bank: 30000, cash: 20000 })
  })

  test('クレジットカードは使うとマイナスになり、銀行からの支払いで 0 に戻る', () => {
    let balances = applyToBalances({ card: 0, bank: 100000 }, tx({ amount: 12000, accountId: 'card' }), 1)
    expect(balances.card).toBe(-12000)
    balances = applyToBalances(balances, tx({ type: 'transfer', amount: 12000, accountId: 'bank', toAccountId: 'card', categoryId: null }), 1)
    expect(balances).toEqual({ card: 0, bank: 88000 })
  })

  test('変更は「もとを引いて新しいのを足す」で表せる', () => {
    const before = tx({ amount: 1000, accountId: 'cash' })
    const after = tx({ amount: 1200, accountId: 'bank' })
    let balances = applyToBalances({ cash: 5000, bank: 5000 }, before, 1)
    balances = applyToBalances(applyToBalances(balances, before, -1), after, 1)
    expect(balances).toEqual({ cash: 5000, bank: 3800 })
  })
})

describe('入力の確認', () => {
  test('金額の入力のゆれを吸収する', () => {
    expect(parseAmount('1,280')).toBe(1280)
    expect(parseAmount('１２８０円')).toBe(1280)
    expect(parseAmount(' 500 ')).toBe(500)
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
    expect(parseAmount('12.5')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })

  test('存在しない日付は受け付けない', () => {
    expect(isValidDate('2026-02-28')).toBe(true)
    expect(isValidDate('2028-02-29')).toBe(true)
    expect(isValidDate('2026-02-29')).toBe(false)
    expect(isValidDate('2026-13-01')).toBe(false)
    expect(isValidDate('2026/11/02')).toBe(false)
  })

  test('記録の内容を確かめる', () => {
    expect(validateTransaction(tx())).toBeNull()
    expect(validateTransaction(tx({ categoryId: null }))).toBe('分類を選んでください。')
    expect(validateTransaction(tx({ amount: 0 }))).not.toBeNull()
    expect(validateTransaction(tx({ type: 'transfer', categoryId: null, toAccountId: null }))).toBe('入金先の口座を選んでください。')
    expect(validateTransaction(tx({ type: 'transfer', categoryId: null, toAccountId: 'cash' }))).toBe('出金元と入金先には、別の口座を選んでください。')
    expect(validateTransaction(tx({ type: 'transfer', categoryId: null, toAccountId: 'bank' }))).toBeNull()
  })
})

describe('月の扱い', () => {
  test('年をまたいで月を動かせる', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2026-11', -12)).toBe('2025-11')
  })

  test('月を日本語で表す', () => {
    expect(formatMonth('2026-01')).toBe('2026年1月')
  })
})

describe('予算（F-50〜F-52）', () => {
  const budgets = [
    { categoryId: 'food', fromMonth: '2026-09', amount: 40000 },
    { categoryId: 'food', fromMonth: '2026-11', amount: 35000 },
    { categoryId: 'food', fromMonth: '2027-02', amount: null },
    { categoryId: 'fun', fromMonth: '2026-10', amount: 10000 },
  ]

  test('決めた月から先に引き継ぎ、途中から変えた分はその月から先だけ変わる', () => {
    expect(budgetFor(budgets, 'food', '2026-08')).toBeNull()
    expect(budgetFor(budgets, 'food', '2026-09')).toBe(40000)
    expect(budgetFor(budgets, 'food', '2026-10')).toBe(40000)
    expect(budgetFor(budgets, 'food', '2026-11')).toBe(35000)
    expect(budgetFor(budgets, 'food', '2027-01')).toBe(35000)
    expect(budgetFor(budgets, 'food', '2027-02')).toBeNull()
    expect(budgetFor(budgets, 'fun', '2027-05')).toBe(10000)
  })

  test('同じ分類・同じ月の設定は置き換える', () => {
    const next = setBudget(budgets, 'food', '2026-11', 30000)
    expect(next.filter((b) => b.categoryId === 'food' && b.fromMonth === '2026-11')).toEqual([{ categoryId: 'food', fromMonth: '2026-11', amount: 30000 }])
    expect(next).toHaveLength(budgets.length)
  })
})

describe('並べ替え', () => {
  const items = [
    { id: 'a', order: 0, kind: 'x' },
    { id: 'b', order: 1, kind: 'x' },
    { id: 'c', order: 0, kind: 'y' },
    { id: 'd', order: 2, kind: 'x' },
  ]
  const sameKind = (p: { kind: string }, q: { kind: string }) => p.kind === q.kind

  test('同じ種類の中で 1 つ動かし、順番を振り直す', () => {
    const moved = moveItem(items, 'd', -1, sameKind)
    expect(moved.filter((i) => i.kind === 'x').sort((p, q) => p.order - q.order).map((i) => i.id)).toEqual(['a', 'd', 'b'])
    expect(moved.find((i) => i.id === 'c')!.order).toBe(0)
  })

  test('端より先には動かさない', () => {
    expect(moveItem(items, 'a', -1, sameKind)).toEqual(items)
  })
})
