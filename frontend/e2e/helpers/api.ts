/**
 * API helpers for Playwright test seeding.
 * These call the backend directly to set up state before UI tests run.
 */

const BASE = process.env.BASE_URL || 'http://localhost:8080'

async function apiRequest(path: string, method: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined
  return res.json()
}

export async function loginAs(email: string, password: string): Promise<string> {
  const res = await apiRequest('/auth/login', 'POST', { email, password })
  return res.token as string
}

export async function getAdminToken(): Promise<string> {
  return loginAs('admin@lms.local', 'changeme')
}

export async function createUser(
  adminToken: string,
  email: string,
  name: string,
  role: string,
  password: string
): Promise<number> {
  const res = await apiRequest('/admin/users', 'POST', { email, name, role, password }, adminToken)
  return res.id as number
}

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<string> {
  const res = await apiRequest('/auth/change-password', 'POST',
    { currentPassword, newPassword }, token)
  return res.token as string
}

export async function createGroup(token: string, name: string): Promise<number> {
  const res = await apiRequest('/groups', 'POST', { name }, token)
  return res.id as number
}

export async function createTeam(token: string, groupId: number, name: string): Promise<number> {
  const res = await apiRequest(`/groups/${groupId}/teams`, 'POST', { name }, token)
  return res.id as number
}

export async function createPlayer(token: string, name: string, userId?: number): Promise<number> {
  const res = await apiRequest('/players', 'POST', { name, userId }, token)
  return res.id as number
}

export async function createGame(
  token: string,
  params: {
    name: string
    groupId: number
    playerNames: string[]
    pickMode?: 'manager' | 'player'
    winnerMode?: 'single' | 'multiple'
    rolloverMode?: 'round' | 'game'
    maxWinners?: number
    postponeAsWin?: boolean
  }
): Promise<number> {
  const res = await apiRequest('/games', 'POST', {
    pickMode: 'manager',
    winnerMode: 'single',
    rolloverMode: 'round',
    maxWinners: 1,
    postponeAsWin: false,
    ...params,
  }, token)
  return res.id as number
}
