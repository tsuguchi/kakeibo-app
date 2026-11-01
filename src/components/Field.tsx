import { useId, type ComponentProps } from 'react'
import { ErrorText } from './dads/ErrorText'
import { Input } from './dads/Input'

type FieldProps = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string
  // 入力のヒント（例: 10 文字以上）
  support?: string
  error?: string | null
}

// ラベル・ヒント・エラー文を、画面読み上げソフトでも入力欄と結び付けて表示する
export function Field({ label, support, error, className, ...inputProps }: FieldProps) {
  const id = useId()
  const supportId = `${id}-support`
  const errorId = `${id}-error`
  const describedBy = [support && supportId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-std-17B-170">
        {label}
        {inputProps.required && <span className="ml-2 text-std-16N-170 text-error-1">※必須</span>}
      </label>
      {support && <p id={supportId} className="text-std-16N-170 text-solid-gray-600">{support}</p>}
      <Input
        id={id}
        isError={Boolean(error)}
        aria-describedby={describedBy}
        className={className ?? 'w-full'}
        {...inputProps}
      />
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </div>
  )
}
