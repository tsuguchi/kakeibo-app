import { createContext, useContext } from 'react'
import type { DataStore } from '../lib/data/repository'
import type { Account, Balances, Budget, Category } from '../lib/data/types'

export interface DataState {
  store: DataStore
  categories: Category[]
  accounts: Account[]
  balances: Balances
  budgets: Budget[]
  categoryName: (id: string | null) => string
  accountName: (id: string | null) => string
}

export const DataContext = createContext<DataState | null>(null)

export function useData(): DataState {
  const state = useContext(DataContext)
  if (!state) throw new Error('useData は DataProvider の中で使ってください')
  return state
}
