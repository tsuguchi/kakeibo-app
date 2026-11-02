// 記録の追加・変更・削除で、月ごとの集計と口座の残高をどう変えるか（DATA_MODEL.md 4.1）。
// Firestore に触れない計算だけをここに置き、テストしやすくする
import type { Balances, Summary, TransactionData } from './types'

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

export function emptySummary(): Summary {
  return { income: 0, expense: 0, byCategory: {} }
}

function addTo(record: Record<string, number>, key: string, delta: number) {
  const next = (record[key] ?? 0) + delta
  if (next === 0) delete record[key]
  else record[key] = next
}

// sign が 1 なら記録を足し、-1 なら引く（変更のときは、もとの記録を引いてから新しい記録を足す）
export function applyToSummary(summary: Summary, tx: TransactionData, sign: 1 | -1): Summary {
  const next: Summary = { ...summary, byCategory: { ...summary.byCategory } }
  if (tx.type === 'transfer') return next
  const delta = tx.amount * sign
  if (tx.type === 'income') next.income += delta
  else next.expense += delta
  if (tx.categoryId) addTo(next.byCategory, tx.categoryId, delta)
  return next
}

export function applyToBalances(balances: Balances, tx: TransactionData, sign: 1 | -1): Balances {
  const next = { ...balances }
  const delta = tx.amount * sign
  switch (tx.type) {
    case 'income':
      next[tx.accountId] = (next[tx.accountId] ?? 0) + delta
      break
    case 'expense':
      next[tx.accountId] = (next[tx.accountId] ?? 0) - delta
      break
    case 'transfer':
      next[tx.accountId] = (next[tx.accountId] ?? 0) - delta
      if (tx.toAccountId) next[tx.toAccountId] = (next[tx.toAccountId] ?? 0) + delta
      break
  }
  return next
}

// 金額の上限（1 兆円）。JavaScript の数で誤差なく足し引きできる範囲に十分収まる
export const MAX_AMOUNT = 1_000_000_000_000

// 入力のゆれ（全角数字・カンマ・「円」・空白）を吸収して金額にする。正しくなければ null
export function parseAmount(text: string): number | null {
  const normalized = text.normalize('NFKC').replace(/[,\s円]/g, '')
  if (!/^\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return amount > 0 && amount <= MAX_AMOUNT ? amount : null
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

// 保存してよい記録か。だめなら理由を返す
export function validateTransaction(tx: TransactionData): string | null {
  if (!isValidDate(tx.date)) return '日付を正しく入力してください。'
  if (!Number.isInteger(tx.amount) || tx.amount <= 0 || tx.amount > MAX_AMOUNT) return '金額は 1 円以上の整数で入力してください。'
  if (!tx.accountId) return tx.type === 'transfer' ? '出金元の口座を選んでください。' : '口座を選んでください。'
  if (tx.type === 'transfer') {
    if (!tx.toAccountId) return '入金先の口座を選んでください。'
    if (tx.toAccountId === tx.accountId) return '出金元と入金先には、別の口座を選んでください。'
  } else if (!tx.categoryId) {
    return '分類を選んでください。'
  }
  return null
}

// 今日の日付（端末の時刻で YYYY-MM-DD）
export function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const index = year * 12 + (monthNumber - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

const yenFormat = new Intl.NumberFormat('ja-JP')

export function formatYen(amount: number): string {
  return `${yenFormat.format(amount)}円`
}

export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  return `${year}年${monthNumber}月`
}
