import { describe, expect, test } from 'vitest'
import { dueOccurrences, isHoliday, scheduledDate, shiftDate, type RecurringRule } from '../../src/lib/data/recurring'

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'r1',
    type: 'expense',
    day: 27,
    amount: 85000,
    categoryId: 'rent',
    accountId: 'bank',
    toAccountId: null,
    memo: '家賃',
    startMonth: '2026-09',
    endMonth: null,
    shift: 'none',
    active: true,
    generatedThrough: '2026-08',
    ...overrides,
  }
}

describe('休日', () => {
  test('土日・祝日・振替休日・年末年始は休日', () => {
    expect(isHoliday('2026-11-07')).toBe(true) // 土曜
    expect(isHoliday('2026-11-08')).toBe(true) // 日曜
    expect(isHoliday('2026-11-03')).toBe(true) // 文化の日
    expect(isHoliday('2026-05-06')).toBe(true) // 振替休日
    expect(isHoliday('2026-12-31')).toBe(true) // 銀行の年末の休み（平日）
    expect(isHoliday('2027-01-04')).toBe(false) // 仕事始め（月曜）
    expect(isHoliday('2026-11-02')).toBe(false) // 平日
  })

  test('祝日の一覧より先の年は、土日と年末年始だけを休日にする', () => {
    expect(isHoliday('2030-01-02')).toBe(true)
    expect(isHoliday('2030-01-14')).toBe(false) // 成人の日だが一覧にない
  })
})

describe('予定日とずらし', () => {
  test('その月にない日付は月末', () => {
    expect(scheduledDate('2026-02', 31)).toBe('2026-02-28')
    expect(scheduledDate('2028-02', 30)).toBe('2028-02-29')
    expect(scheduledDate('2026-04', 'last')).toBe('2026-04-30')
    expect(scheduledDate('2026-11', 5)).toBe('2026-11-05')
  })

  test('前の平日・次の平日にずらす', () => {
    // 2026-10-25 は日曜
    expect(shiftDate('2026-10-25', 'prev')).toBe('2026-10-23')
    expect(shiftDate('2026-10-25', 'next')).toBe('2026-10-26')
    expect(shiftDate('2026-10-25', 'none')).toBe('2026-10-25')
    // 年末年始と週末が続くとき: 2026-12-31（木）→ 2027-01-04（月）
    expect(shiftDate('2026-12-31', 'next')).toBe('2027-01-04')
    // 連休: 2026-05-03（日）〜05-06（水・振替休日）→ 05-07
    expect(shiftDate('2026-05-03', 'next')).toBe('2026-05-07')
    expect(shiftDate('2026-05-03', 'prev')).toBe('2026-05-01')
  })
})

describe('今日までに日付が来た分', () => {
  test('開始の月から今日まで、月ごとに 1 件', () => {
    const due = dueOccurrences(rule(), '2026-11-02')
    expect(due.map((o) => o.date)).toEqual(['2026-09-27', '2026-10-27'])
  })

  test('今日がちょうど予定日なら、その日の分も作る', () => {
    expect(dueOccurrences(rule({ day: 2 }), '2026-11-02').map((o) => o.date)).toEqual(['2026-09-02', '2026-10-02', '2026-11-02'])
  })

  test('作り終えた月より後だけを作る', () => {
    expect(dueOccurrences(rule({ generatedThrough: '2026-09' }), '2026-11-02').map((o) => o.month)).toEqual(['2026-10'])
  })

  test('終了の月より後と、停止中は作らない', () => {
    expect(dueOccurrences(rule({ endMonth: '2026-09' }), '2026-11-02').map((o) => o.month)).toEqual(['2026-09'])
    expect(dueOccurrences(rule({ active: false }), '2026-11-02')).toEqual([])
  })

  test('次の平日にずらした分は、ずらした後の日付が来てから作る。月をまたいだら、その月の記録になる', () => {
    // 2027-01-31 は日曜 → 2027-02-01（月）
    const r = rule({ day: 31, shift: 'next', startMonth: '2027-01', generatedThrough: '2026-12' })
    expect(dueOccurrences(r, '2027-01-31')).toEqual([])
    expect(dueOccurrences(r, '2027-02-01')).toEqual([{ month: '2027-01', date: '2027-02-01', originalDate: '2027-01-31' }])
  })

  test('前の平日にずらすと、翌月 1 日の分が今月に来ることがある', () => {
    // 2026-11-01 は日曜 → 前の平日は 2026-10-30（金）
    const r = rule({ type: 'income', day: 1, shift: 'prev', startMonth: '2026-11', generatedThrough: '2026-10' })
    expect(dueOccurrences(r, '2026-10-30')).toEqual([{ month: '2026-11', date: '2026-10-30', originalDate: '2026-11-01' }])
  })
})
