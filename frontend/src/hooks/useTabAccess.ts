import type { Role } from '../types'

export type Tab = 'fixtures' | 'manager' | 'games' | 'reports'

const TAB_ORDER: Tab[] = ['fixtures', 'manager', 'games', 'reports']

// Index in TAB_ORDER at which each role starts having access
const ROLE_START: Record<string, number> = {
  manager: 0,   // fixtures and everything right
  games: 2,     // games and everything right
  reports: 3,   // reports only
}

export function useTabAccess(role: Role): Tab[] {
  if (role === 'admin' || role === 'player') return []
  const start = ROLE_START[role] ?? TAB_ORDER.length
  return TAB_ORDER.slice(start)
}
