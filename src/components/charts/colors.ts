// グラフの色。DADS の色から選び、dataviz の検査（明るさ・彩度・色覚の違いでの見分けやすさ・背景とのコントラスト）を
// 白の背景で通したもの（2026-11-02、収入↔支出 の ΔE 40.1、色覚シミュレーションで 33.1、どちらも 3:1 以上）。
// 色は「収入」「支出」という種類に付け、並び順では変えない
export const SERIES_COLORS = {
  income: 'var(--color-blue-600)',
  expense: 'var(--color-orange-700)',
} as const

// 予算のメーター。満たした部分と、同じ青の薄い段の下地。超えたら DADS のエラー色に変え、文字でも「超過」と示す
export const METER_COLORS = {
  fill: 'var(--color-blue-600)',
  track: 'var(--color-blue-100)',
  over: 'var(--color-error-1)',
} as const

// 目盛りと軸。背景から 1 段だけ離した灰色の細い実線
export const GRID_COLOR = 'var(--color-solid-gray-200)'
