import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './dads/Button'
import { ErrorText } from './dads/ErrorText'
import { Field } from './Field'

export interface ManagedItem {
  id: string
  name: string
  order: number
  hidden: boolean
}

interface ManageListProps<T extends ManagedItem> {
  // 一覧の見出し（例: 支出の分類）
  label: string
  items: T[]
  // 名前の横に出す補足（例: 口座の種類と残高）
  describe?: (item: T) => ReactNode
  onMove: (id: string, delta: -1 | 1) => Promise<void>
  onToggleHidden: (id: string) => Promise<void>
  // 変更の入力欄。省略すると名前だけを変える欄を出す
  renderEditor?: (item: T, close: () => void) => ReactNode
  onRename?: (id: string, name: string) => Promise<void>
}

// 分類や口座の、並べ替え・名前の変更・非表示（F-21、F-32）。使った記録を壊さないよう、削除はせず非表示にする
export function ManageList<T extends ManagedItem>({ label, items, describe, onMove, onToggleHidden, renderEditor, onRename }: ManageListProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = items.filter((item) => !item.hidden).sort((a, b) => a.order - b.order)
  const hidden = items.filter((item) => item.hidden).sort((a, b) => a.order - b.order)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      console.error(caught)
      setError('変更できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  function row(item: T, index: number, list: T[]) {
    if (editingId === item.id) {
      const close = () => setEditingId(null)
      return (
        <li key={item.id} className="border-b border-solid-gray-200 py-4">
          {renderEditor ? renderEditor(item, close) : <RenameForm item={item} onSave={(name) => onRename!(item.id, name).then(close)} onCancel={close} />}
        </li>
      )
    }
    return (
      <li key={item.id} className="flex flex-col gap-2 border-b border-solid-gray-200 py-3 desktop:flex-row desktop:items-center desktop:justify-between">
        <span className="min-w-0">
          <span className="block text-std-16B-170">{item.name}</span>
          {describe && <span className="block text-dns-14N-130 text-solid-gray-600">{describe(item)}</span>}
        </span>
        <span className="flex flex-wrap gap-2">
          {!item.hidden && (
            <>
              <Button type="button" variant="outline" size="sm" aria-disabled={busy || index === 0} aria-label={`${item.name}を上へ`} onClick={() => run(() => onMove(item.id, -1))}>
                上へ
              </Button>
              <Button type="button" variant="outline" size="sm" aria-disabled={busy || index === list.length - 1} aria-label={`${item.name}を下へ`} onClick={() => run(() => onMove(item.id, 1))}>
                下へ
              </Button>
            </>
          )}
          <Button type="button" variant="outline" size="sm" aria-disabled={busy} aria-label={`${item.name}を変更`} onClick={() => setEditingId(item.id)}>
            変更
          </Button>
          <Button type="button" variant="text" size="sm" aria-disabled={busy} aria-label={`${item.name}を${item.hidden ? '表示する' : '非表示にする'}`} onClick={() => run(() => onToggleHidden(item.id))}>
            {item.hidden ? '表示する' : '非表示にする'}
          </Button>
        </span>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-std-18B-160">{label}</h3>
      {error && <ErrorText role="alert">{error}</ErrorText>}
      <ul>{visible.map((item, index) => row(item, index, visible))}</ul>
      {hidden.length > 0 && (
        <details className="rounded-8 border border-solid-gray-420 p-4">
          <summary className="cursor-pointer text-std-16B-170">非表示にしたもの（{hidden.length} 件）</summary>
          <p className="mt-2 text-dns-14N-130 text-solid-gray-600">入力の選択肢には出ません。過去の記録はそのまま残っています。</p>
          <ul className="mt-2">{hidden.map((item, index) => row(item, index, hidden))}</ul>
        </details>
      )}
    </div>
  )
}

function RenameForm({ item, onSave, onCancel }: { item: ManagedItem, onSave: (name: string) => Promise<void>, onCancel: () => void }) {
  const [name, setName] = useState(item.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('名前を入力してください。')
      return
    }
    setBusy(true)
    try {
      await onSave(trimmed)
    } catch (caught) {
      console.error(caught)
      setError('変更できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
      <Field label={`「${item.name}」の名前`} required maxLength={40} autoFocus value={name} error={error} onChange={(event) => setName(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid-fill" size="md" aria-disabled={busy}>保存する</Button>
        <Button type="button" variant="outline" size="md" onClick={onCancel}>やめる</Button>
      </div>
    </form>
  )
}
