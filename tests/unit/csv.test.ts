import { describe, expect, test } from 'vitest'
import {
  buildImportRows,
  decodeCsv,
  detectEncoding,
  exportRows,
  findDuplicates,
  guessMapping,
  isExportFormat,
  parseCsv,
  parseDate,
  parseExportRows,
  parseSignedAmount,
  toCsv,
} from '../../src/lib/data/csv'
import type { Transaction } from '../../src/lib/data/types'

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'x', month: '2026-11', type: 'expense', date: '2026-11-02', amount: 1000, categoryId: 'food',
    accountId: 'bank', toAccountId: null, memo: '', source: { kind: 'manual' }, ...overrides,
  }
}

describe('CSV の読み書き', () => {
  test('引用符・カンマ・改行・"" を含む列を読める', () => {
    expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",h\n\n')).toEqual([['a', 'b,c', 'd"e'], ['f\ng', 'h']])
  })

  test('書き出しは BOM 付き・CRLF で、読み直すと元に戻る', () => {
    const rows = [['日付', 'メモ'], ['2026-11-02', 'カンマ,と"引用符"']]
    const text = toCsv(rows)
    expect(text.startsWith('﻿')).toBe(true)
    expect(text).toContain('\r\n')
    expect(parseCsv(text)).toEqual(rows)
  })

  test('式として動く書き出しを防ぐ', () => {
    expect(toCsv([['=HYPERLINK("x")', '+1', '-5', '@a']])).toBe('﻿"\'=HYPERLINK(""x"")",\'+1,-5,\'@a\r\n')
  })

  test('UTF-8 と Shift_JIS を見分ける', () => {
    const utf8 = new TextEncoder().encode('日付,金額')
    expect(detectEncoding(utf8)).toBe('utf-8')
    // 「日付」の Shift_JIS
    const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74])
    expect(detectEncoding(sjis)).toBe('shift_jis')
    expect(decodeCsv(sjis, 'shift_jis')).toBe('日付')
  })
})

describe('値の読み取り', () => {
  test('日付のいろいろな書き方', () => {
    expect(parseDate('2026/11/2')).toBe('2026-11-02')
    expect(parseDate('2026-11-02')).toBe('2026-11-02')
    expect(parseDate('2026年11月2日')).toBe('2026-11-02')
    expect(parseDate('20261102')).toBe('2026-11-02')
    expect(parseDate('２０２６／１１／０２')).toBe('2026-11-02')
    expect(parseDate('2026/02/30')).toBeNull()
    expect(parseDate('11/02')).toBeNull()
  })

  test('金額のいろいろな書き方', () => {
    expect(parseSignedAmount('1,280')).toBe(1280)
    expect(parseSignedAmount('¥1,280')).toBe(1280)
    expect(parseSignedAmount('-1280')).toBe(-1280)
    expect(parseSignedAmount('△1,280')).toBe(-1280)
    expect(parseSignedAmount('')).toBe(0)
    expect(parseSignedAmount('12.5')).toBeNull()
  })
})

describe('明細の取り込み', () => {
  const bank = parseCsv('取引日,お取引内容,お支払金額,お預入金額,残高\n2026/11/01,カード払い,12000,,88000\n2026/11/05,給与,,280000,368000\n2026/11/07,不明な行,abc,,0\n')

  test('列の見出しから、日付・出金・入金・内容の列を推測する', () => {
    expect(guessMapping(bank[0])).toMatchObject({ date: 0, amountMode: 'split', withdrawal: 2, deposit: 3, memo: 1 })
  })

  test('出金と入金が別の列の明細', () => {
    const rows = buildImportRows(bank, guessMapping(bank[0]))
    expect(rows[0]).toEqual({ line: 2, date: '2026-11-01', type: 'expense', amount: 12000, memo: 'カード払い', problem: null })
    expect(rows[1]).toMatchObject({ type: 'income', amount: 280000 })
    expect(rows[2]).toMatchObject({ line: 4, problem: '金額を読み取れません' })
  })

  test('1 つの列で、プラスが支払いのカードの明細', () => {
    const card = parseCsv('利用日,利用店名,利用金額\n2026/11/03,スーパー,2480\n2026/11/04,返品,-500\n')
    const mapping = guessMapping(card[0])
    expect(mapping).toMatchObject({ amountMode: 'single', amount: 2, positiveIsExpense: true, memo: 1 })
    const rows = buildImportRows(card, mapping)
    expect(rows.map((row) => [row.type, row.amount])).toEqual([['expense', 2480], ['income', 500]])
  })
})

describe('重複の見分け（F-74）', () => {
  const existing = [
    tx({ id: 'e1', date: '2026-11-02', amount: 1000, memo: 'スーパー' }),
    tx({ id: 'e2', date: '2026-11-05', amount: 3000, memo: '手入力' }),
    tx({ id: 'e3', date: '2026-11-02', amount: 1000, memo: 'スーパー', accountId: 'cash' }),
  ]

  test('日付・金額・種類・内容が同じなら「同じ記録」、金額と種類が同じで 3 日以内なら「似た記録」', () => {
    const result = findDuplicates([
      { date: '2026-11-02', type: 'expense', amount: 1000, memo: 'スーパー' },
      { date: '2026-11-07', type: 'expense', amount: 3000, memo: 'カード' },
      { date: '2026-11-12', type: 'expense', amount: 3000, memo: 'カード' },
    ], existing, 'bank')
    expect(result.map((match) => match && [match.kind, match.existing.id])).toEqual([['same', 'e1'], ['similar', 'e2'], null])
  })

  test('既存の記録 1 件は 1 行とだけ組にする（同じ週の同じ金額の 2 回目は重複にしない）', () => {
    const result = findDuplicates([
      { date: '2026-11-02', type: 'expense', amount: 1000, memo: 'スーパー' },
      { date: '2026-11-02', type: 'expense', amount: 1000, memo: 'スーパー' },
    ], existing, 'bank')
    expect(result.map((match) => match?.kind ?? null)).toEqual(['same', null])
  })

  test('ほかの口座の記録とは比べない', () => {
    const result = findDuplicates([{ date: '2026-11-02', type: 'expense', amount: 1000, memo: 'スーパー' }], existing.filter((t) => t.id === 'e3'), 'bank')
    expect(result).toEqual([null])
  })
})

describe('このアプリの形式', () => {
  const categories = [{ id: 'food', kind: 'expense' as const, name: '食費' }]
  const accounts = [{ id: 'bank', name: '銀行' }, { id: 'cash', name: '現金' }]

  test('書き出して読み直すと同じ記録になる', () => {
    const records = [
      tx({ id: 'a', memo: '-割引' }),
      tx({ id: 'b', type: 'transfer', categoryId: null, accountId: 'bank', toAccountId: 'cash', amount: 20000, memo: '' }),
    ]
    const names: Record<string, string> = { food: '食費', bank: '銀行', cash: '現金' }
    const rows = parseCsv(toCsv(exportRows(records, (id) => names[id!], (id) => names[id!])))
    expect(isExportFormat(rows[0])).toBe(true)
    const parsed = parseExportRows(rows, categories, accounts)
    expect(parsed.map((row) => row.problem)).toEqual([null, null])
    expect(parsed[0].data).toMatchObject({ type: 'expense', amount: 1000, categoryId: 'food', accountId: 'bank', memo: '-割引' })
    expect(parsed[1].data).toMatchObject({ type: 'transfer', accountId: 'bank', toAccountId: 'cash', categoryId: null })
  })

  test('名前が見つからない行は理由を示す', () => {
    const parsed = parseExportRows([['日付'], ['2026-11-02', '支出', '500', '外食', '銀行', '', '', '手入力']], categories, accounts)
    expect(parsed[0].problem).toBe('支出の分類「外食」がありません')
  })
})
