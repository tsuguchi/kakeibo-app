// 内閣府の「国民の祝日」の CSV から、アプリに組み込む祝日の一覧（src/lib/data/holidays.json）を作る（F-66）。
// 内閣府は翌年分を例年 2 月ごろに公開するので、そのたびに npm run holidays を実行してコミットする
import { writeFile } from 'node:fs/promises'

const SOURCE = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
const FROM_YEAR = 2020 // これより前の記録は自動記録の対象にならないので持たない

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`祝日の CSV を取得できませんでした（HTTP ${response.status}）`)
const text = new TextDecoder('shift_jis').decode(await response.arrayBuffer())

const dates = []
for (const line of text.split(/\r?\n/).slice(1)) {
  const match = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),/)
  if (!match) continue
  const [, year, month, day] = match
  if (Number(year) < FROM_YEAR) continue
  dates.push(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)
}
if (dates.length < 50) throw new Error(`祝日の数が少なすぎます（${dates.length} 件）。CSV の形が変わった可能性があります`)
dates.sort()

const data = {
  source: SOURCE,
  fetchedAt: new Date().toISOString().slice(0, 10),
  lastYear: Number(dates.at(-1).slice(0, 4)),
  dates,
}
await writeFile(new URL('../src/lib/data/holidays.json', import.meta.url), `${JSON.stringify(data, null, 2)}\n`)
console.log(`${dates.length} 件の祝日を書き出しました（${dates[0]}〜${dates.at(-1)}）`)
