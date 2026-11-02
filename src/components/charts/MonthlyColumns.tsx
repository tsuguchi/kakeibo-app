import { useEffect, useRef, useState } from 'react'
import { formatMonth, formatYen } from '../../lib/data/ledger'
import { GRID_COLOR, SERIES_COLORS } from './colors'

export interface MonthTotals {
  month: string
  income: number
  expense: number
}

const HEIGHT = 220
const MARGIN = { top: 12, right: 8, bottom: 28, left: 52 }
const COLUMN_MAX = 14
const GAP = 2
const TOOLTIP_WIDTH = 168

// 目盛りをきりのよい数に。1 万円以上の軸は「10万」のように短く書く
function niceStep(max: number): number {
  const rough = max / 4
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= rough)!
  return step
}

function tickLabel(value: number, compact: boolean): string {
  if (value === 0 || !compact) return value.toLocaleString('ja-JP')
  const man = value / 10000
  return `${Number.isInteger(man) ? man : man.toFixed(1)}万`
}

// 上だけ 4px 丸めた縦棒（根元は角）
function columnPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

function shortMonth(month: string): string {
  return `${Number(month.slice(5))}月`
}

// 12 か月の収入・支出の移り変わり（F-42）。軸は 1 本（円）だけ。凡例・ホバーとキーボードで出る説明・表を付ける（F-43）
export function MonthlyColumns({ data }: { data: MonthTotals[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const max = Math.max(...data.flatMap((d) => [d.income, d.expense]), 0)
  const step = max > 0 ? niceStep(max) : 10000
  const top = Math.max(step * Math.ceil(max / step), step)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const compact = top >= 10000

  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const band = plotWidth / data.length
  const column = Math.min(COLUMN_MAX, (band - GAP - 6) / 2)
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight
  const activeData = active === null ? null : data[active]

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex gap-4 text-dns-14N-130" aria-label="凡例">
        {(['income', 'expense'] as const).map((key) => (
          <li key={key} className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block size-3 rounded-[2px]" style={{ backgroundColor: SERIES_COLORS[key] }} />
            {key === 'income' ? '収入' : '支出'}
          </li>
        ))}
      </ul>

      <div ref={containerRef} className="relative w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="group"
          aria-label="12 か月の収入と支出の棒グラフ。月ごとに選ぶと金額を読み上げます"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={GRID_COLOR} strokeWidth={1} />
              <text x={MARGIN.left - 6} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-solid-gray-600 text-[12px] tabular-nums">
                {tickLabel(tick, compact)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = MARGIN.left + i * band
            const center = x0 + band / 2
            const label = `${formatMonth(d.month)}: 収入 ${formatYen(d.income)}、支出 ${formatYen(d.expense)}、差額 ${d.income - d.expense < 0 ? '−' : ''}${formatYen(Math.abs(d.income - d.expense))}`
            return (
              <g key={d.month}>
                {/* 選んだ月を薄い灰色で示す */}
                {active === i && <rect x={x0} y={MARGIN.top} width={band} height={plotHeight} className="fill-solid-gray-50" />}
                {d.income > 0 && <path d={columnPath(center - GAP / 2 - column, y(d.income), column, y(0) - y(d.income))} fill={SERIES_COLORS.income} />}
                {d.expense > 0 && <path d={columnPath(center + GAP / 2, y(d.expense), column, y(0) - y(d.expense))} fill={SERIES_COLORS.expense} />}
                {/* 幅が狭いときは、ラベルが重ならないよう 1 か月おきに出す（いちばん新しい月は必ず出す）。ほかの月は説明と表で読める */}
                {(band >= 36 || (data.length - 1 - i) % 2 === 0) && (
                  <text x={center} y={HEIGHT - 8} textAnchor="middle" className="fill-solid-gray-600 text-[12px]">
                    {shortMonth(d.month)}
                  </text>
                )}
                {/* 当たり判定は月の帯全体。棒そのものより広くして、ねらいやすくする */}
                <rect
                  x={x0}
                  y={MARGIN.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={label}
                  className="outline-none focus-visible:stroke-black focus-visible:stroke-2"
                  onPointerMove={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} stroke="var(--color-solid-gray-420)" strokeWidth={1} />
        </svg>

        {activeData && active !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 z-10 rounded-8 border border-solid-gray-420 bg-white px-3 py-2 text-dns-14N-130 shadow-2"
            style={{
              // 選んだ月の棒を隠さないよう、帯の右に出す。右に入りきらなければ左に出す
              left: MARGIN.left + (active + 1) * band + 4 + TOOLTIP_WIDTH <= width
                ? MARGIN.left + (active + 1) * band + 4
                : Math.max(MARGIN.left + active * band - 4 - TOOLTIP_WIDTH, 0),
              width: TOOLTIP_WIDTH,
            }}
          >
            <p className="text-dns-14B-130">{formatMonth(activeData.month)}</p>
            {(['income', 'expense'] as const).map((key) => (
              <p key={key} className="mt-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-solid-gray-600">
                  <span aria-hidden="true" className="inline-block h-0.5 w-3" style={{ backgroundColor: SERIES_COLORS[key] }} />
                  {key === 'income' ? '収入' : '支出'}
                </span>
                <span className="font-bold tabular-nums">{formatYen(activeData[key])}</span>
              </p>
            ))}
            <p className="mt-1 flex justify-between gap-2 border-t border-solid-gray-200 pt-1">
              <span className="text-solid-gray-600">差額</span>
              <span className="font-bold tabular-nums">
                {activeData.income - activeData.expense < 0 ? '−' : ''}{formatYen(Math.abs(activeData.income - activeData.expense))}
              </span>
            </p>
          </div>
        )}
      </div>

      <details className="rounded-8 border border-solid-gray-420 p-4">
        <summary className="cursor-pointer text-std-16B-170">表で見る</summary>
        <table className="mt-3 w-full border-collapse text-dns-14N-130">
          <thead>
            <tr className="border-b border-solid-gray-420 text-left text-solid-gray-600">
              <th scope="col" className="py-2 font-normal">月</th>
              <th scope="col" className="py-2 text-right font-normal">収入</th>
              <th scope="col" className="py-2 text-right font-normal">支出</th>
              <th scope="col" className="py-2 text-right font-normal">差額</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month} className="border-b border-solid-gray-200">
                <th scope="row" className="py-2 text-left font-normal">{formatMonth(d.month)}</th>
                <td className="py-2 text-right tabular-nums">{formatYen(d.income)}</td>
                <td className="py-2 text-right tabular-nums">{formatYen(d.expense)}</td>
                <td className={`py-2 text-right tabular-nums ${d.income - d.expense < 0 ? 'text-error-1' : ''}`}>
                  {d.income - d.expense < 0 ? '−' : ''}{formatYen(Math.abs(d.income - d.expense))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
