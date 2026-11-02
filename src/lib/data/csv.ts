// CSV の書き出し・取り込み（F-70〜F-74）。Firestore に触れない変換と判定だけを置く
import { isValidDate, MAX_AMOUNT } from './ledger'
import type { Transaction, TransactionData, TransactionType } from './types'

// ---- 読み書きの基本 ----

// RFC 4180 の CSV を行と列に分ける（引用符の中のカンマ・改行・"" に対応）
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // 空の行は捨てる
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

function escapeCell(value: string): string {
  // 表計算ソフトで式として動かないよう、= + - @ で始まる文字には ' を付ける（CSV インジェクション対策）
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+$/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// Excel で文字化けしないよう、UTF-8（BOM 付き）・改行は CRLF で書く（F-70）
export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}\r\n`
}

export type CsvEncoding = 'utf-8' | 'shift_jis'

// UTF-8 として読めなければ Shift_JIS とみなす（F-72）
export function detectEncoding(bytes: Uint8Array): CsvEncoding {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    return 'shift_jis'
  }
}

export function decodeCsv(bytes: Uint8Array, encoding: CsvEncoding): string {
  return new TextDecoder(encoding).decode(bytes)
}

// ---- このアプリの形式 ----

export const EXPORT_HEADER = ['日付', '種類', '金額', '分類', '口座', '入金先の口座', 'メモ', '記録の方法']
const TYPE_NAMES: Record<TransactionType, string> = { income: '収入', expense: '支出', transfer: '振替' }
const SOURCE_NAMES = { manual: '手入力', recurring: '自動', import: '取り込み' } as const

export function exportRows(transactions: Transaction[], categoryName: (id: string | null) => string, accountName: (id: string | null) => string): string[][] {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  return [
    EXPORT_HEADER,
    ...sorted.map((tx) => [
      tx.date,
      TYPE_NAMES[tx.type],
      String(tx.amount),
      tx.type === 'transfer' ? '' : categoryName(tx.categoryId),
      accountName(tx.accountId),
      tx.type === 'transfer' ? accountName(tx.toAccountId) : '',
      tx.memo,
      SOURCE_NAMES[tx.source.kind],
    ]),
  ]
}

export function isExportFormat(header: string[] | undefined): boolean {
  return !!header && EXPORT_HEADER.every((name, index) => header[index]?.trim() === name)
}

// ---- 値の読み取り ----

// 2026/11/2・2026-11-02・2026年11月2日・20261102 を YYYY-MM-DD にする。読めなければ null
export function parseDate(text: string): string | null {
  const normalized = text.normalize('NFKC').trim()
  const match = normalized.match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/) ?? normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (!match) return null
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return isValidDate(date) ? date : null
}

// 金額を符号付きの整数にする。カンマ・円・¥ を取り除き、先頭の - △ ▲ はマイナス。空なら 0、読めなければ null
export function parseSignedAmount(text: string): number | null {
  const normalized = text.normalize('NFKC').replace(/[,\s円¥\\]/g, '').replace(/^[△▲−]/, '-')
  if (normalized === '') return 0
  if (!/^-?\d+$/.test(normalized)) return null
  const amount = Number(normalized)
  return Math.abs(amount) <= MAX_AMOUNT ? amount : null
}

// ---- 明細の取り込み ----

export interface ColumnMapping {
  hasHeader: boolean
  date: number
  // 'single': 1 つの列で、マイナスが支出（またはプラスが支出）。'split': 出金と入金が別の列
  amountMode: 'single' | 'split'
  amount: number
  // single のとき、プラスの金額を支出として扱うか（カードの明細はプラスが支払い）
  positiveIsExpense: boolean
  withdrawal: number
  deposit: number
  // 内容（メモ）の列。-1 なら使わない
  memo: number
}

export interface ImportRow {
  // CSV の何行目か（1 から）
  line: number
  date: string | null
  type: 'income' | 'expense' | null
  amount: number | null
  memo: string
  // 読み取れなかった理由
  problem: string | null
}

export function guessMapping(header: string[]): ColumnMapping {
  const find = (...words: string[]) => header.findIndex((cell) => words.some((word) => cell.includes(word)))
  const withdrawal = find('出金', 'お支払', '支払金額', '引出', '払出')
  const deposit = find('入金', 'お預入', '預入', '預け入れ')
  const date = Math.max(find('日付', '取引日', '利用日', 'ご利用日', '年月日'), 0)
  const memo = find('内容', '摘要', '利用店', 'ご利用先', '取引内容', 'お取引内容', 'メモ', '備考')
  const amount = find('金額', '利用金額')
  return {
    hasHeader: true,
    date,
    amountMode: withdrawal >= 0 && deposit >= 0 ? 'split' : 'single',
    amount: amount >= 0 ? amount : Math.min(1, header.length - 1),
    positiveIsExpense: withdrawal < 0 && deposit < 0,
    withdrawal: Math.max(withdrawal, 0),
    deposit: Math.max(deposit, 0),
    memo,
  }
}

export function buildImportRows(rows: string[][], mapping: ColumnMapping): ImportRow[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows
  const offset = mapping.hasHeader ? 2 : 1
  return body.map((cells, index) => {
    const date = parseDate(cells[mapping.date] ?? '')
    const memo = mapping.memo >= 0 ? (cells[mapping.memo] ?? '').trim().slice(0, 200) : ''
    let signed: number | null
    if (mapping.amountMode === 'split') {
      const out = parseSignedAmount(cells[mapping.withdrawal] ?? '')
      const inn = parseSignedAmount(cells[mapping.deposit] ?? '')
      signed = out === null || inn === null ? null : inn - out
    } else {
      const value = parseSignedAmount(cells[mapping.amount] ?? '')
      signed = value === null ? null : mapping.positiveIsExpense ? -value : value
    }
    let problem: string | null = null
    if (!date) problem = '日付を読み取れません'
    else if (signed === null) problem = '金額を読み取れません'
    else if (signed === 0) problem = '金額が 0 円です'
    return {
      line: index + offset,
      date,
      type: signed === null || signed === 0 ? null : signed < 0 ? 'expense' : 'income',
      amount: signed === null || signed === 0 ? null : Math.abs(signed),
      memo,
      problem,
    }
  })
}

// ---- 重複の見分け（F-74） ----

export type DuplicateKind = 'same' | 'similar'

export interface DuplicateMatch {
  kind: DuplicateKind
  existing: Transaction
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

export const SIMILAR_DAYS = 3

// 取り込み先の口座の既存の記録と比べる。既存の記録 1 件は、明細の 1 行とだけ組にする。
// まず「同じ記録」をすべて組にしてから、残りで「似た記録」を日付の近い順に組にする。
// 取り込む CSV の中の行どうしは比べない（同じ日に同じ金額の買い物はあり得るため）
export function findDuplicates(
  rows: { date: string, type: 'income' | 'expense', amount: number, memo: string }[],
  existing: Transaction[],
  accountId: string,
): (DuplicateMatch | null)[] {
  const candidates = existing.filter((tx) => tx.type !== 'transfer' && tx.accountId === accountId)
  const used = new Set<string>()
  const result: (DuplicateMatch | null)[] = rows.map(() => null)

  rows.forEach((row, index) => {
    const same = candidates.find((tx) => !used.has(tx.id) && tx.date === row.date && tx.type === row.type && tx.amount === row.amount && tx.memo === row.memo)
    if (same) {
      used.add(same.id)
      result[index] = { kind: 'same', existing: same }
    }
  })
  rows.forEach((row, index) => {
    if (result[index]) return
    const similar = candidates
      .filter((tx) => !used.has(tx.id) && tx.type === row.type && tx.amount === row.amount && dayDiff(tx.date, row.date) <= SIMILAR_DAYS)
      .sort((a, b) => dayDiff(a.date, row.date) - dayDiff(b.date, row.date))[0]
    if (similar) {
      used.add(similar.id)
      result[index] = { kind: 'similar', existing: similar }
    }
  })
  return result
}

// ---- このアプリで書き出した CSV の取り込み（F-71） ----

export interface ParsedExportRow {
  line: number
  data: TransactionData | null
  problem: string | null
}

// 分類と口座は名前で探す。見つからない行は取り込まず、理由を示す
export function parseExportRows(
  rows: string[][],
  categories: { id: string, kind: 'income' | 'expense', name: string }[],
  accounts: { id: string, name: string }[],
): ParsedExportRow[] {
  const typeByName = Object.fromEntries(Object.entries(TYPE_NAMES).map(([type, name]) => [name, type as TransactionType]))
  const accountId = (name: string) => accounts.find((account) => account.name === name.trim())?.id ?? null
  return rows.slice(1).map((cells, index) => {
    const line = index + 2
    const [dateText = '', typeText = '', amountText = '', categoryText = '', accountText = '', toAccountText = '', memoText = ''] = cells
    const date = parseDate(dateText)
    const type = typeByName[typeText.trim()]
    const amount = parseSignedAmount(amountText)
    const fail = (problem: string): ParsedExportRow => ({ line, data: null, problem })
    if (!date) return fail('日付を読み取れません')
    if (!type) return fail('種類が「収入」「支出」「振替」のどれでもありません')
    if (amount === null || amount <= 0) return fail('金額を読み取れません')
    const from = accountId(accountText)
    if (!from) return fail(`口座「${accountText}」がありません`)
    let categoryId: string | null = null
    let toAccountId: string | null = null
    if (type === 'transfer') {
      toAccountId = accountId(toAccountText)
      if (!toAccountId) return fail(`入金先の口座「${toAccountText}」がありません`)
    } else {
      categoryId = categories.find((category) => category.kind === type && category.name === categoryText.trim())?.id ?? null
      if (!categoryId) return fail(`${TYPE_NAMES[type]}の分類「${categoryText}」がありません`)
    }
    // 書き出しのときに式の対策で付けた ' を外す
    const memo = memoText.replace(/^'(?=[=+\-@\t\r])/, '').slice(0, 200)
    return { line, problem: null, data: { type, date, amount, categoryId, accountId: from, toAccountId, memo, source: { kind: 'import' } } }
  })
}
