// 初めて記録を開いたときに用意する分類と口座（F-20）
import type { Account, Category, CategoryKind } from './types'

const EXPENSE_NAMES = ['食費', '日用品', '住居費', '水道光熱費', '通信費', '交通費', '医療費', '娯楽費', 'その他']
const INCOME_NAMES = ['給与', '賞与', 'その他']

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function categories(kind: CategoryKind, names: string[]): Category[] {
  return names.map((name, order) => ({ id: newId(), kind, name, order, hidden: false }))
}

export function defaultCategories(): Category[] {
  return [...categories('expense', EXPENSE_NAMES), ...categories('income', INCOME_NAMES)]
}

export function defaultAccounts(): Account[] {
  return [{ id: newId(), type: 'cash', name: '現金', openingBalance: 0, order: 0, hidden: false }]
}
