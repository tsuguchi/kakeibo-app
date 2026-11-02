import { useId } from 'react'
import { Select } from './dads/Select'

// ラベル・ヒントと結び付けた必須の選択肢
export function SelectField({ label, value, onChange, options, support }: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string, label: string }[]
  support?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-std-17B-170">
        {label}
        <span className="ml-2 text-std-16N-170 text-error-1">※必須</span>
      </label>
      {support && <p id={`${id}-support`} className="text-std-16N-170 text-solid-gray-600">{support}</p>}
      <Select
        id={id}
        className="w-full desktop:w-80"
        // required を付けると、まだ選んでいないうちから「無効」と読み上げられるため、aria-required にする
        aria-required
        aria-describedby={support ? `${id}-support` : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">選んでください</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
    </div>
  )
}
