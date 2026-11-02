import { monthOf, shiftMonth, today } from '../lib/data/ledger'
import { Button } from './dads/Button'

export function MonthSwitcher({ month, onChange }: { month: string, onChange: (month: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="md" onClick={() => onChange(shiftMonth(month, -1))}>前の月</Button>
      <Button type="button" variant="outline" size="md" onClick={() => onChange(shiftMonth(month, 1))}>次の月</Button>
      {month !== monthOf(today()) && (
        <Button type="button" variant="text" size="md" onClick={() => onChange(monthOf(today()))}>今月に戻る</Button>
      )}
    </div>
  )
}
