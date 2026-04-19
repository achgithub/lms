export type Role = 'admin' | 'manager' | 'games' | 'reports' | 'player'

export interface AuthUser {
  id: number
  email: string
  name: string
  role: Role
  mustChangePw: boolean
}

export interface Group {
  id: number
  managerId: number
  name: string
  createdAt: string
  teamCount?: number
}

export interface Team {
  id: number
  groupId: number
  name: string
  createdAt: string
}

export interface Player {
  id: number
  managerId: number
  userId?: number
  name: string
  createdAt: string
}

export interface Game {
  id: number
  managerId: number
  name: string
  groupId: number
  status: 'active' | 'completed'
  winnerName?: string
  postponeAsWin: boolean
  winnerMode: 'single' | 'multiple'
  rolloverMode: 'round' | 'game'
  maxWinners: number
  pickMode: 'manager' | 'player'
  createdAt: string
}

export interface GameWithDetails extends Game {
  groupName: string
  participantCount: number
  currentRound: number
}

export interface Participant {
  id: number
  gameId: number
  userId?: number
  playerName: string
  isActive: boolean
  eliminatedInRound?: number
  createdAt: string
}

export interface Round {
  id: number
  gameId: number
  roundNumber: number
  status: 'open' | 'closed'
  createdAt: string
}

export interface Pick {
  id: number
  gameId: number
  roundId: number
  playerName: string
  teamId?: number
  teamName?: string
  fixtureId?: number
  pickedSide?: 'home' | 'away'
  result?: 'win' | 'loss' | 'draw' | 'postponed'
  autoAssigned: boolean
  createdAt: string
}

export interface User {
  id: number
  email: string
  name: string
  role: Role
  mustChangePw: boolean
  isActive: boolean
  createdAt: string
}

export interface FixtureRow {
  id: number
  apiMatchId: number
  competitionCode: string
  competitionName: string
  matchDate: string
  homeTeam: string
  awayTeam: string
  status: string
  homeScore: number | null
  awayScore: number | null
}

export interface Competition {
  id: number
  name: string
  code: string
  area: { name: string }
}

export interface FootballTeam {
  id: number
  name: string
  shortName: string
}
