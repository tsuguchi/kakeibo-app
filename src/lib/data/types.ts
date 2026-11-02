// 家計のデータの型（DATA_MODEL.md 3 章）。どれも暗号化して保存する中身

export type CategoryKind = 'income' | 'expense'

export interface Category {
  id: string
  kind: CategoryKind
  name: string
  order: number
  hidden: boolean
}

export type AccountType = 'cash' | 'bank' | 'credit' | 'emoney' | 'other'

export interface Account {
  id: string
  type: AccountType
  name: string
  // 使い始めの残高（円）
  openingBalance: number
  order: number
  hidden: boolean
}

export type TransactionType = 'income' | 'expense' | 'transfer'

export interface TransactionSource {
  kind: 'manual' | 'recurring' | 'import'
  recurringId?: string
  // 自動記録で休日をずらす前の日付（F-63、F-65）
  originalDate?: string
}

// 記録の中身（transactions/{txId} の enc）
export interface TransactionData {
  type: TransactionType
  // YYYY-MM-DD
  date: string
  // 1 円単位の正の整数。収入か支出かは type で表す
  amount: number
  // 振替のときは null
  categoryId: string | null
  // 振替のときは出金元
  accountId: string
  // 振替の入金先。収入・支出のときは null
  toAccountId: string | null
  memo: string
  source: TransactionSource
}

export interface Transaction extends TransactionData {
  id: string
  // YYYY-MM（暗号化しない。月ごとの読み込みに使う）
  month: string
}

// 月ごとの集計（summaries/{YYYY-MM} の enc）。振替は含めない
export interface Summary {
  income: number
  expense: number
  // 分類ごとの金額（収入の分類と支出の分類の両方）
  byCategory: Record<string, number>
}

// 口座ごとの今の残高（meta/balances の enc）
export type Balances = Record<string, number>

export interface ItemList<T> {
  items: T[]
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: '現金',
  bank: '銀行',
  credit: 'クレジットカード',
  emoney: '電子マネー',
  other: 'その他',
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  expense: '支出',
  income: '収入',
  transfer: '振替',
}
