// 家計のデータの読み書き。すべて暗号化してから保存し、読み込んだら復号する（DATA_MODEL.md 3〜4 章）
import {
  Bytes as FirestoreBytes,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction as FirestoreTransaction,
} from 'firebase/firestore'
import type { DataKeys } from '../crypto/keys'
import { decryptJson, encryptJson, recurringTransactionId, type Envelope } from '../crypto/envelope'
import { defaultAccounts, defaultCategories } from './defaults'
import { applyToBalances, applyToSummary, emptySummary, monthOf, validateTransaction } from './ledger'
import { dueOccurrences, type Occurrence, type RecurringRule } from './recurring'
import type { Account, Balances, Budget, Category, ItemList, Summary, Transaction, TransactionData } from './types'

export type MetaName = 'categories' | 'accounts' | 'balances' | 'budgets' | 'recurring'

interface StoredEnvelope {
  v: number
  iv: FirestoreBytes
  ct: FirestoreBytes
}

function toStored(envelope: Envelope): StoredEnvelope {
  return { v: envelope.v, iv: FirestoreBytes.fromUint8Array(envelope.iv), ct: FirestoreBytes.fromUint8Array(envelope.ct) }
}

function fromStored(stored: StoredEnvelope): Envelope {
  return { v: stored.v, iv: new Uint8Array(stored.iv.toUint8Array()), ct: new Uint8Array(stored.ct.toUint8Array()) }
}

export class DataStore {
  private readonly db: Firestore
  private readonly uid: string
  private readonly keys: DataKeys

  constructor(db: Firestore, uid: string, keys: DataKeys) {
    this.db = db
    this.uid = uid
    this.keys = keys
  }

  private metaRef(name: MetaName) {
    return doc(this.db, 'users', this.uid, 'meta', name)
  }

  private summaryRef(month: string) {
    return doc(this.db, 'users', this.uid, 'summaries', month)
  }

  private transactionRef(id: string) {
    return doc(this.db, 'users', this.uid, 'transactions', id)
  }

  // 新しい記録の ID（Firestore の自動 ID）
  newTransactionId(): string {
    return doc(collection(this.db, 'users', this.uid, 'transactions')).id
  }

  private encrypt(ref: DocumentReference, value: unknown) {
    return encryptJson(this.keys, ref.path, value).then(toStored)
  }

  private async decrypt<T>(snapshot: DocumentSnapshot): Promise<T | null> {
    const stored = snapshot.get('enc') as StoredEnvelope | undefined
    return stored ? decryptJson<T>(this.keys, snapshot.ref.path, fromStored(stored)) : null
  }

  private async readInTransaction<T>(transaction: FirestoreTransaction, ref: DocumentReference): Promise<T | null> {
    return this.decrypt<T>(await transaction.get(ref))
  }

  // 1 つのドキュメントを見張り、変わるたびに復号して知らせる。まだなければ null
  private subscribeDoc<T>(ref: DocumentReference, onChange: (value: T | null) => void, onError: (error: Error) => void) {
    // 復号は非同期なので、古いスナップショットの結果が後から届いても使わない
    let latest = 0
    return onSnapshot(
      ref,
      (snapshot) => {
        const current = ++latest
        this.decrypt<T>(snapshot).then(
          (value) => current === latest && onChange(value),
          onError,
        )
      },
      onError,
    )
  }

  subscribeMeta<T>(name: MetaName, onChange: (value: T | null) => void, onError: (error: Error) => void) {
    return this.subscribeDoc<T>(this.metaRef(name), onChange, onError)
  }

  subscribeSummary(month: string, onChange: (summary: Summary) => void, onError: (error: Error) => void) {
    return this.subscribeDoc<Summary>(this.summaryRef(month), (summary) => onChange(summary ?? emptySummary()), onError)
  }

  // その月の記録を見張る。並べ替えはブラウザで行う（日付は暗号化しているため）
  subscribeMonth(month: string, onChange: (transactions: Transaction[]) => void, onError: (error: Error) => void) {
    let latest = 0
    const q = query(collection(this.db, 'users', this.uid, 'transactions'), where('month', '==', month))
    return onSnapshot(
      q,
      (snapshot) => {
        const current = ++latest
        Promise.all(
          snapshot.docs.map(async (docSnapshot) => {
            const data = (await this.decrypt<TransactionData>(docSnapshot))!
            return { ...data, id: docSnapshot.id, month: docSnapshot.get('month') as string }
          }),
        ).then((transactions) => {
          if (current !== latest) return
          transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
          onChange(transactions)
        }, onError)
      },
      onError,
    )
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    const snapshot = await getDoc(this.transactionRef(id))
    const data = await this.decrypt<TransactionData>(snapshot)
    return data ? { ...data, id, month: snapshot.get('month') as string } : null
  }

  // 分類・口座がまだなければ用意する（F-20）。別の端末と同時でも、二重には作らない
  async ensureDefaults(): Promise<void> {
    const categoriesRef = this.metaRef('categories')
    const accountsRef = this.metaRef('accounts')
    const balancesRef = this.metaRef('balances')
    await runTransaction(this.db, async (transaction) => {
      const existing = await transaction.get(categoriesRef)
      if (existing.exists()) return
      const accounts = defaultAccounts()
      const balances: Balances = Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]))
      transaction.set(categoriesRef, { enc: await this.encrypt(categoriesRef, { items: defaultCategories() }) })
      transaction.set(accountsRef, { enc: await this.encrypt(accountsRef, { items: accounts }) })
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, balances) })
    })
  }

  // 口座を足す。残高は使い始めの残高から始める（F-30）
  async addAccount(account: Account): Promise<void> {
    const accountsRef = this.metaRef('accounts')
    const balancesRef = this.metaRef('balances')
    await runTransaction(this.db, async (transaction) => {
      const accounts = (await this.readInTransaction<ItemList<Account>>(transaction, accountsRef)) ?? { items: [] }
      const balances = (await this.readInTransaction<Balances>(transaction, balancesRef)) ?? {}
      const next = { items: [...accounts.items, { ...account, order: accounts.items.length }] }
      transaction.set(accountsRef, { enc: await this.encrypt(accountsRef, next) })
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, { ...balances, [account.id]: account.openingBalance }) })
    })
  }

  // meta の 1 つのドキュメントを読み直してから書き換える。別の端末と同時に変えても、片方の変更が消えない
  private async updateMeta<T>(name: MetaName, update: (current: T | null) => T): Promise<void> {
    const ref = this.metaRef(name)
    await runTransaction(this.db, async (transaction) => {
      const current = await this.readInTransaction<T>(transaction, ref)
      transaction.set(ref, { enc: await this.encrypt(ref, update(current)) })
    })
  }

  // 分類の追加・名前の変更・並べ替え・非表示（F-21）
  updateCategories(update: (items: Category[]) => Category[]): Promise<void> {
    return this.updateMeta<ItemList<Category>>('categories', (current) => ({ items: update(current?.items ?? []) }))
  }

  // その月の記録を 1 回だけ読む（CSV の書き出しと、取り込みのときの重複の見分けに使う）
  async getMonth(month: string): Promise<Transaction[]> {
    const snapshot = await getDocs(query(collection(this.db, 'users', this.uid, 'transactions'), where('month', '==', month)))
    return Promise.all(
      snapshot.docs.map(async (docSnapshot) => ({
        ...(await this.decrypt<TransactionData>(docSnapshot))!,
        id: docSnapshot.id,
        month: docSnapshot.get('month') as string,
      })),
    )
  }

  // 取り込んだ記録をまとめて保存する（F-73）。集計と残高も同じトランザクションで更新する。
  // 1 回のトランザクションの書き込み件数の上限（500 件）に収まるよう、呼ぶ側で 50 件ずつに分ける
  async addTransactions(items: TransactionData[]): Promise<void> {
    for (const item of items) {
      const invalid = validateTransaction(item)
      if (invalid) throw new Error(invalid)
    }
    const balancesRef = this.metaRef('balances')
    const withIds = items.map((data) => ({ id: this.newTransactionId(), data }))
    await runTransaction(this.db, async (transaction) => {
      const months = [...new Set(items.map((item) => monthOf(item.date)))]
      const summaries = new Map<string, Summary>()
      for (const month of months) {
        summaries.set(month, (await this.readInTransaction<Summary>(transaction, this.summaryRef(month))) ?? emptySummary())
      }
      let balances = (await this.readInTransaction<Balances>(transaction, balancesRef)) ?? {}
      for (const { id, data } of withIds) {
        const month = monthOf(data.date)
        summaries.set(month, applyToSummary(summaries.get(month)!, data, 1))
        balances = applyToBalances(balances, data, 1)
        const txRef = this.transactionRef(id)
        transaction.set(txRef, { month, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), enc: await this.encrypt(txRef, data) })
      }
      for (const [month, summary] of summaries) {
        const ref = this.summaryRef(month)
        transaction.set(ref, { enc: await this.encrypt(ref, summary) })
      }
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, balances) })
    })
  }

  // 毎月の自動記録の設定の追加・変更・停止（F-60、F-64）。すでに記録した分は変わらない
  updateRecurring(update: (items: RecurringRule[]) => RecurringRule[]): Promise<void> {
    return this.updateMeta<ItemList<RecurringRule>>('recurring', (current) => ({ items: update(current?.items ?? []) }))
  }

  // 今日までに日付が来た自動記録を作る（F-61、F-62、DATA_MODEL.md 4.2）。作った件数を返す。
  // 設定・記録・集計・残高を 1 つのトランザクションで書くので、2 台で同時に開いても二重にならない
  async runRecurring(today: string, maxPerRun = 60): Promise<number> {
    const recurringRef = this.metaRef('recurring')
    const balancesRef = this.metaRef('balances')
    return runTransaction(this.db, async (transaction) => {
      const rules = (await this.readInTransaction<ItemList<RecurringRule>>(transaction, recurringRef))?.items ?? []
      // 1 回のトランザクションの書き込み件数の上限（500 件）に収まるよう、件数を区切る。残りは次に開いたときに作る
      const planned: { rule: RecurringRule, occurrence: Occurrence, id: string }[] = []
      for (const rule of rules) {
        for (const occurrence of dueOccurrences(rule, today)) {
          if (planned.length >= maxPerRun) break
          planned.push({ rule, occurrence, id: await recurringTransactionId(this.keys, rule.id, occurrence.month) })
        }
      }
      if (planned.length === 0) return 0

      // 読み込みはすべて書き込みより前に行う
      const existing = await Promise.all(planned.map(({ id }) => transaction.get(this.transactionRef(id))))
      const toCreate = planned.filter((_, index) => !existing[index].exists())
      const months = [...new Set(toCreate.map(({ occurrence }) => monthOf(occurrence.date)))]
      const summaries = new Map<string, Summary>()
      for (const month of months) {
        summaries.set(month, (await this.readInTransaction<Summary>(transaction, this.summaryRef(month))) ?? emptySummary())
      }
      let balances = (await this.readInTransaction<Balances>(transaction, balancesRef)) ?? {}

      for (const { rule, occurrence, id } of toCreate) {
        const data: TransactionData = {
          type: rule.type,
          date: occurrence.date,
          amount: rule.amount,
          categoryId: rule.type === 'transfer' ? null : rule.categoryId,
          accountId: rule.accountId,
          toAccountId: rule.type === 'transfer' ? rule.toAccountId : null,
          memo: rule.memo,
          source: { kind: 'recurring', recurringId: rule.id, originalDate: occurrence.originalDate },
        }
        const month = monthOf(data.date)
        summaries.set(month, applyToSummary(summaries.get(month)!, data, 1))
        balances = applyToBalances(balances, data, 1)
        const txRef = this.transactionRef(id)
        transaction.set(txRef, { month, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), enc: await this.encrypt(txRef, data) })
      }
      for (const [month, summary] of summaries) {
        const ref = this.summaryRef(month)
        transaction.set(ref, { enc: await this.encrypt(ref, summary) })
      }
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, balances) })

      // 作った分（すでにあった分も含む）の月まで進める。利用者が消した分を作り直さないため
      const through = new Map<string, string>()
      for (const { rule, occurrence } of planned) {
        if (occurrence.month > (through.get(rule.id) ?? '')) through.set(rule.id, occurrence.month)
      }
      const nextRules = rules.map((rule) => (through.has(rule.id) ? { ...rule, generatedThrough: through.get(rule.id)! } : rule))
      transaction.set(recurringRef, { enc: await this.encrypt(recurringRef, { items: nextRules }) })
      return toCreate.length
    })
  }

  // 予算の変更（F-50〜F-52）
  updateBudgets(update: (items: Budget[]) => Budget[]): Promise<void> {
    return this.updateMeta<ItemList<Budget>>('budgets', (current) => ({ items: update(current?.items ?? []) }))
  }

  // 口座の名前の変更・並べ替え・非表示（F-32）。使い始めの残高を変えたときは、その差を今の残高にも反映する
  async updateAccounts(update: (items: Account[]) => Account[]): Promise<void> {
    const accountsRef = this.metaRef('accounts')
    const balancesRef = this.metaRef('balances')
    await runTransaction(this.db, async (transaction) => {
      const before = (await this.readInTransaction<ItemList<Account>>(transaction, accountsRef))?.items ?? []
      const balances = (await this.readInTransaction<Balances>(transaction, balancesRef)) ?? {}
      const after = update(before)
      const nextBalances = { ...balances }
      for (const account of after) {
        const previous = before.find((item) => item.id === account.id)
        if (previous && previous.openingBalance !== account.openingBalance) {
          nextBalances[account.id] = (nextBalances[account.id] ?? 0) + account.openingBalance - previous.openingBalance
        }
      }
      transaction.set(accountsRef, { enc: await this.encrypt(accountsRef, { items: after }) })
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, nextBalances) })
    })
  }

  // 記録の追加・変更（F-10〜F-12）。記録・月ごとの集計・口座の残高を 1 つのトランザクションで書き込む
  async saveTransaction(id: string, data: TransactionData): Promise<void> {
    const invalid = validateTransaction(data)
    if (invalid) throw new Error(invalid)
    await this.writeTransaction(id, data)
  }

  // 記録の削除（F-12）
  async deleteTransaction(id: string): Promise<void> {
    await this.writeTransaction(id, null)
  }

  private async writeTransaction(id: string, next: TransactionData | null): Promise<void> {
    const txRef = this.transactionRef(id)
    const balancesRef = this.metaRef('balances')
    await runTransaction(this.db, async (transaction) => {
      // もとの記録は、画面が持っている値ではなく、トランザクションの中で読み直したものを使う
      const currentSnapshot = await transaction.get(txRef)
      const previous = await this.decrypt<TransactionData>(currentSnapshot)
      const months = [...new Set([previous, next].flatMap((tx) => (tx ? [monthOf(tx.date)] : [])))]
      const summaries = await Promise.all(
        months.map(async (month) => ({
          month,
          summary: (await this.readInTransaction<Summary>(transaction, this.summaryRef(month))) ?? emptySummary(),
        })),
      )
      let balances = (await this.readInTransaction<Balances>(transaction, balancesRef)) ?? {}

      for (const entry of summaries) {
        if (previous && monthOf(previous.date) === entry.month) entry.summary = applyToSummary(entry.summary, previous, -1)
        if (next && monthOf(next.date) === entry.month) entry.summary = applyToSummary(entry.summary, next, 1)
      }
      if (previous) balances = applyToBalances(balances, previous, -1)
      if (next) balances = applyToBalances(balances, next, 1)

      for (const { month, summary } of summaries) {
        const ref = this.summaryRef(month)
        transaction.set(ref, { enc: await this.encrypt(ref, summary) })
      }
      transaction.set(balancesRef, { enc: await this.encrypt(balancesRef, balances) })

      if (!next) {
        transaction.delete(txRef)
        return
      }
      const enc = await this.encrypt(txRef, next)
      transaction.set(txRef, {
        month: monthOf(next.date),
        createdAt: currentSnapshot.exists() ? currentSnapshot.get('createdAt') : serverTimestamp(),
        updatedAt: serverTimestamp(),
        enc,
      })
    })
  }
}
