import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'

interface GameOption {
  id: number
  name: string
  status: string
  managerName?: string
}

interface RoundReport {
  roundNumber: number
  status: string
  activePlayers?: number
  teamPicks?: Record<string, number>
  eliminatedCount?: number
  throughCount?: number
  teamResults?: Record<string, string>
}

interface ReportData {
  game: {
    name: string
    status: string
    winnerName: string
    winnerMode: string
    rolloverMode: string
    postponeAsWin: boolean
    maxWinners: number
    startingPlayers: number
  }
  rounds: RoundReport[]
}

export default function ReportsTab() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [games, setGames] = useState<GameOption[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number>(0)
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const endpoint = isAdmin ? '/admin/reports' : '/games'
    api.get<{ games: GameOption[] }>(endpoint).then(res => setGames(res.games ?? []))
  }, [isAdmin])

  async function loadReport(id: number) {
    if (!id) return
    setLoading(true)
    setError('')
    setReport(null)
    try {
      const res = await api.get<ReportData>(`/report/${id}`)
      setReport(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  function handleSelectGame(id: number) {
    setSelectedGameId(id)
    loadReport(id)
  }

  const resultColor: Record<string, string> = {
    win: '#166534', loss: '#991b1b', draw: '#854d0e', postponed: '#475569'
  }
  const resultIcon: Record<string, string> = {
    win: '▲', loss: '▼', draw: '=', postponed: '~'
  }

  return (
    <div data-testid="page-reports">
      <div className="card">
        <h2>Reports</h2>
        <div className="form-group" style={{ marginBottom: '1rem' }}>
          <label htmlFor="report-game-select">Select Game</label>
          <select
            id="report-game-select"
            value={selectedGameId}
            onChange={e => handleSelectGame(Number(e.target.value))}
            data-testid="select-report-game"
            aria-label="Select game for report"
            style={{ minWidth: '280px' }}
          >
            <option value={0}>— choose a game —</option>
            {games.map(g => (
              <option key={g.id} value={g.id}>
                {isAdmin && g.managerName ? `[${g.managerName}] ` : ''}{g.name} ({g.status})
              </option>
            ))}
          </select>
        </div>
        {error && <p className="error" role="alert" data-testid="report-error">{error}</p>}
      </div>

      {loading && <div className="empty">Loading report…</div>}

      {report && (
        <div data-testid="report-content">
          <div className="card" data-testid="report-game-summary">
            <h2>{report.game.name}</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.875rem', color: '#64748b' }}>
              <span>Status: <strong>{report.game.status}</strong></span>
              <span>Players: <strong>{report.game.startingPlayers}</strong></span>
              <span>Winner mode: <strong>{report.game.winnerMode}</strong></span>
              <span>Rollover: <strong>{report.game.rolloverMode}</strong></span>
              {report.game.winnerName && (
                <span style={{ color: '#22c55e' }}>🏆 Winner: <strong>{report.game.winnerName}</strong></span>
              )}
            </div>
          </div>

          {report.rounds.map(r => (
            <div key={r.roundNumber} className="card" data-testid={`report-round-${r.roundNumber}`}>
              <h3>Round {r.roundNumber}
                <span className={`badge ${r.status === 'open' ? 'badge-open' : 'badge-closed'}`}
                  style={{ marginLeft: '0.5rem' }} data-testid={`badge-round-status-${r.roundNumber}`}>
                  {r.status}
                </span>
              </h3>

              {r.status === 'open' && (
                <div>
                  <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: '#64748b' }}>
                    Active players: <strong>{r.activePlayers}</strong>
                  </p>
                  {r.teamPicks && Object.keys(r.teamPicks).length > 0 && (
                    <div data-testid={`team-picks-${r.roundNumber}`}>
                      <h3>Team Pick Distribution</h3>
                      {Object.entries(r.teamPicks).sort(([,a],[,b]) => b - a).map(([team, count]) => (
                        <div key={team} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.3rem 0' }}
                          data-testid={`team-pick-row-${r.roundNumber}-${team.replace(/\s+/g,'-')}`}>
                          <span style={{ minWidth: '160px', fontSize: '0.875rem' }}>{team}</span>
                          <div style={{ background: '#3b82f6', height: '16px', width: `${count * 30}px`, borderRadius: '2px' }} />
                          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {r.status === 'closed' && (
                <div>
                  <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: '#64748b' }}>
                    Eliminated: <strong style={{ color: '#ef4444' }}><span aria-hidden="true">✕ </span>{r.eliminatedCount}</strong>
                    {' · '}Through: <strong style={{ color: '#22c55e' }}><span aria-hidden="true">✓ </span>{r.throughCount}</strong>
                  </p>
                  {r.teamResults && Object.keys(r.teamResults).length > 0 && (
                    <div data-testid={`team-results-${r.roundNumber}`}>
                      <h3>Team Results</h3>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {Object.entries(r.teamResults).map(([team, result]) => (
                          <span key={team}
                            style={{ padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.8rem',
                              background: '#f1f5f9', color: resultColor[result] ?? '#1a1a1a', fontWeight: 500 }}
                            data-testid={`team-result-${r.roundNumber}-${team.replace(/\s+/g,'-')}`}>
                            <span aria-hidden="true">{resultIcon[result] ?? '·'} </span>{team}: {result}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {report.rounds.length === 0 && (
            <div className="empty" data-testid="no-rounds">No rounds played yet.</div>
          )}
        </div>
      )}
    </div>
  )
}
