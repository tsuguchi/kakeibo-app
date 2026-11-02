import { formatYen } from '../../lib/data/ledger'
import type { TransactionData } from '../../lib/data/types'

// 色だけに頼らず、収入は「+」、支出は「−」を付けて表す（F-43 と同じ考え方）
export function amountLabel(tx: Pick<TransactionData, 'type' | 'amount'>): string {
  if (tx.type === 'income') return `+${formatYen(tx.amount)}`
  if (tx.type === 'expense') return `−${formatYen(tx.amount)}`
  return formatYen(tx.amount)
}
