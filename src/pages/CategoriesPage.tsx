import { useState, type FormEvent } from 'react'
import { Button } from '../components/dads/Button'
import { Radio } from '../components/dads/Radio'
import { Field } from '../components/Field'
import { Layout, MainNav } from '../components/Layout'
import { ManageList } from '../components/ManageList'
import { useData } from '../data/context'
import { newId } from '../lib/data/defaults'
import { moveItem } from '../lib/data/ledger'
import type { CategoryKind } from '../lib/data/types'

const KIND_LABELS: Record<CategoryKind, string> = { expense: '支出', income: '収入' }

// 分類の追加・名前の変更・並べ替え・非表示（F-20、F-21）
export function CategoriesPage() {
  const { store, categories } = useData()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // 並べ替えは、同じ種類で、表示・非表示が同じものの中だけで行う（非表示のものと入れ替わって動かないように見えるのを防ぐ）
  const sameKind = (a: { kind: CategoryKind, hidden: boolean }, b: { kind: CategoryKind, hidden: boolean }) => a.kind === b.kind && a.hidden === b.hidden

  async function add(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('分類の名前を入力してください。')
      return
    }
    if (categories.some((category) => category.kind === kind && category.name === trimmed)) {
      setError(`「${trimmed}」は、${KIND_LABELS[kind]}の分類にすでにあります。`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await store.updateCategories((items) => [
        ...items,
        { id: newId(), kind, name: trimmed, order: items.filter((item) => item.kind === kind).length, hidden: false },
      ])
      setName('')
      setMessage(`${KIND_LABELS[kind]}の分類「${trimmed}」を追加しました。`)
    } catch (caught) {
      console.error(caught)
      setError('追加できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title="分類" headerEnd={<MainNav />}>
      <p>分類は、記録の入力のときに選ぶ一覧です。使わなくなった分類は非表示にできます（過去の記録は残ります）。</p>

      <section aria-labelledby="list-heading" className="flex flex-col gap-6">
        <h2 id="list-heading" className="sr-only">分類の一覧</h2>
        {(['expense', 'income'] as CategoryKind[]).map((listKind) => (
          <ManageList
            key={listKind}
            label={`${KIND_LABELS[listKind]}の分類`}
            items={categories.filter((category) => category.kind === listKind)}
            onMove={(id, delta) => store.updateCategories((items) => moveItem(items, id, delta, sameKind))}
            onToggleHidden={(id) => store.updateCategories((items) => items.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)))}
            onRename={(id, nextName) => store.updateCategories((items) => items.map((item) => (item.id === id ? { ...item, name: nextName } : item)))}
          />
        ))}
      </section>

      <section aria-labelledby="add-heading" className="flex flex-col gap-4">
        <h2 id="add-heading" className="text-std-20B-150">分類を追加する</h2>
        <form className="flex flex-col gap-6" onSubmit={add} noValidate>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-std-17B-170">種類</legend>
            <div className="flex gap-x-6">
              {(['expense', 'income'] as CategoryKind[]).map((value) => (
                <Radio key={value} name="kind" value={value} size="md" checked={kind === value} onChange={() => setKind(value)}>
                  {KIND_LABELS[value]}
                </Radio>
              ))}
            </div>
          </fieldset>
          <Field label="名前" required autoComplete="off" maxLength={40} value={name} error={error} onChange={(event) => setName(event.target.value)} />
          {message && <p role="status">{message}</p>}
          <div>
            <Button type="submit" variant="solid-fill" size="lg" aria-disabled={busy}>追加する</Button>
          </div>
        </form>
      </section>
    </Layout>
  )
}
