// 毎月の自動記録の日付の計算（F-60〜F-66、DATA_MODEL.md 4.2）。Firestore に触れない計算だけを置く
import holidays from './holidays.json'
import { monthOf, shiftMonth } from './ledger'
import type { TransactionType } from './types'

export type ShiftRule = 'none' | 'prev' | 'next'

export interface RecurringRule {
  id: string
  type: TransactionType
  // 1〜31、または月末
  day: number | 'last'
  amount: number
  categoryId: string | null
  accountId: string
  toAccountId: string | null
  memo: string
  // YYYY-MM
  startMonth: string
  endMonth: string | null
  shift: ShiftRule
  active: boolean
  // 記録を作り終えた最後の月（ずらす前の月）。まだなければ startMonth の前の月
  generatedThrough: string
}

export interface Occurrence {
  // ずらす前の月（generatedThrough に入れる値）
  month: string
  // ずらした後の日付（記録の日付）
  date: string
  // ずらす前の日付
  originalDate: string
}

export const HOLIDAY_DATA_LAST_YEAR: number = holidays.lastYear
const HOLIDAYS = new Set<string>(holidays.dates)

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function fromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
}

// 休日は、土日・国民の祝日（振替休日などを含む）・銀行の年末年始の休み（12/31〜1/3）（F-65）。
// 組み込んだ祝日の一覧より先の年は、土日と年末年始だけを休日として扱う（F-66）
export function isHoliday(date: string, holidaySet: ReadonlySet<string> = HOLIDAYS): boolean {
  const weekday = toDate(date).getUTCDay()
  if (weekday === 0 || weekday === 6) return true
  const monthDay = date.slice(5)
  if (monthDay === '12-31' || monthDay === '01-01' || monthDay === '01-02' || monthDay === '01-03') return true
  return holidaySet.has(date)
}

// その月の予定日。その月にない日付（例: 2 月 31 日）は月末にする（F-61）
export function scheduledDate(month: string, day: number | 'last'): string {
  const last = daysInMonth(month)
  return `${month}-${pad(day === 'last' ? last : Math.min(day, last))}`
}

export function shiftDate(date: string, shift: ShiftRule, holiday: (date: string) => boolean = isHoliday): string {
  if (shift === 'none') return date
  const step = shift === 'prev' ? -1 : 1
  const current = toDate(date)
  // 年末年始と連休が重なっても十分に抜けられる回数で打ち切る
  for (let i = 0; i < 14 && holiday(fromDate(current)); i++) current.setUTCDate(current.getUTCDate() + step)
  return fromDate(current)
}

// 今日までに日付が来た分（F-61）。ずらした後の日付が今日より後の月に当たったら、そこで止める。
// 「前の平日」にずらすと翌月 1 日の分が今月に来ることがあるので、今日の翌月までを見る
export function dueOccurrences(rule: RecurringRule, today: string, holiday: (date: string) => boolean = isHoliday): Occurrence[] {
  if (!rule.active) return []
  const result: Occurrence[] = []
  const lastMonth = shiftMonth(monthOf(today), 1)
  let month = shiftMonth(rule.generatedThrough, 1)
  if (month < rule.startMonth) month = rule.startMonth
  while (month <= lastMonth && (!rule.endMonth || month <= rule.endMonth)) {
    const originalDate = scheduledDate(month, rule.day)
    const date = shiftDate(originalDate, rule.shift, holiday)
    if (date > today) break
    result.push({ month, date, originalDate })
    month = shiftMonth(month, 1)
  }
  return result
}

// 種類ごとの、休日のずらし方の初期値（F-65）。給料は前倒し、口座の引き落としは後ろ倒しが多い
export function defaultShift(type: TransactionType): ShiftRule {
  return type === 'income' ? 'prev' : 'next'
}

export const SHIFT_LABELS: Record<ShiftRule, string> = {
  none: 'ずらさない',
  prev: '前の平日',
  next: '次の平日',
}
