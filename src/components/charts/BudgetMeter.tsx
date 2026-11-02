import { formatYen } from '../../lib/data/ledger'
import { METER_COLORS } from './colors'

// 予算に対する使った額のメーター（F-51）。色だけに頼らず、「残り」「超過」を文字でも示す
export function BudgetMeter({ label, used, budget }: { label: string, used: number, budget: number }) {
  const over = used > budget
  const ratio = budget > 0 ? Math.min(used / budget, 1) : 1
  const percent = budget > 0 ? Math.round((used / budget) * 100) : 0
  const valueText = over
    ? `予算 ${formatYen(budget)} のうち ${formatYen(used)} を使い、${formatYen(used - budget)} 超過（${percent}%）`
    : `予算 ${formatYen(budget)} のうち ${formatYen(used)} を使い、残り ${formatYen(budget - used)}（${percent}%）`

  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={Math.min(used, budget)}
        aria-valuetext={valueText}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: METER_COLORS.track }}
      >
        <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, backgroundColor: over ? METER_COLORS.over : METER_COLORS.fill }} />
      </div>
      <p className="flex flex-wrap justify-between gap-x-4 text-dns-14N-130 text-solid-gray-600" aria-hidden="true">
        <span>{formatYen(used)} / {formatYen(budget)}（{percent}%）</span>
        {over ? (
          <span className="flex items-center gap-1 font-bold text-error-1">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
            {formatYen(used - budget)} 超過
          </span>
        ) : (
          <span>残り {formatYen(budget - used)}</span>
        )}
      </p>
    </div>
  )
}
