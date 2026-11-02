import { useSearchParams } from 'react-router'
import { monthOf, today } from '../lib/data/ledger'

// 表示する月。URL の ?month=YYYY-MM に持たせ、戻るボタンや再読み込みでも同じ月を出す
export function useMonth(): [string, (month: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('month')
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : monthOf(today())
  return [month, (next) => setSearchParams({ month: next })]
}
