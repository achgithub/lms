import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { Game, Team } from '../../types'

interface Standing {
  playerName: string
  isActive: boolean
  eliminatedInRound?: number
}

interface PlayerGameDetail {
  game: Game
  standings: Standing[]
  openRoundId: number
  openRound: number
  myPick: { teamId?: number; teamName: string } | null
}

export default function MyGamesPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()

  const [games, setGames] = useState<(Game & { groupName: string; currentRound: number; isActive: boolean; eliminatedInRound?: number })[]>([])
  const [detail, setDetail] = useState<PlayerGameDetail | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<number>(0)
  const [usedTeamIds, setUsedTeamIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (id) {
      loadDetail(Number(id))
    } else {
      loadGames()
    }
  }, [id])

  async function loadGames() {
    try {
      const res = await api.get<{ games: typeof games }>('/player/games')
      setGames(res.games ?? [])
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(gameId: number) {
    try {
      const res = await api.get<PlayerGameDetail>(`/player/games/${gameId}`)
      setDetail(res)
      if (res.game.groupId) {
        const tRes = await api.get<{ teams: Team[] }>(`/groups/${res.game.groupId}/teams`)
        setTeams(tRes.teams ?? [])
      }
      if (res.myPick?.teamId) setSelectedTeam(res.myPick.teamId)
    } finally {
      setLoading(false)
    }
  }

  async function submitPick() {
    if (!detail || !detail.openRoundId || !selectedTeam) return
    setSaving(true)
    setMsg('')
    try {
      await api.post(`/player/rounds/${detail.openRoundId}/pick`, { teamId: selectedTeam })
      setMsg('Pick saved!')
      loadDetail(detail.game.id)
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to save pick')
    } finally {
      setSaving(false)
    }
  }

  const availableTeams = teams.filter(t => !usedTeamIds.includes(t.id))

  if (loading) return <div className="empty">Loading…</div>

  if (id && detail) {
    const { game, standings, openRoundId, openRound, myPick } = detail
    const myStanding = standings.find(s => s.isActive !== undefined)

    return (
      <div data-testid="page-my-game-detail">
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('/my-games')}
          data-testid="btn-back-to-my-games" style={{ marginBottom: '1rem' }}>← My Games</button>

        <div className="card">
          <h2>{game.name}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <span className={`badge ${game.status === 'active' ? 'badge-active' : 'badge-completed'}`}
              data-testid="badge-game-status">{game.status}</span>
            <span className="badge badge-closed">Round {openRound || '—'}</span>
          </div>
          {game.winnerName && (
            <p style={{ color: '#22c55e' }} data-testid="game-winner">🏆 Winner: {game.winnerName}</p>
          )}
        </div>

        {/* My pick */}
        {openRoundId > 0 && game.status === 'active' && (
          <div className="card" data-testid="my-pick-panel">
            <h2>Round {openRound} — Your Pick</h2>
            {myPick?.teamName && (
              <p style={{ marginBottom: '0.75rem', color: '#64748b' }}>
                Current pick: <strong>{myPick.teamName}</strong>
              </p>
            )}
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="my-team-pick">Select Team</label>
                <select id="my-team-pick" value={selectedTeam}
                  onChange={e => setSelectedTeam(Number(e.target.value))}
                  data-testid="select-my-pick" aria-label="Select your team pick">
                  <option value={0}>— choose a team —</option>
                  {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button className="btn btn-primary" onClick={submitPick}
                disabled={saving || !selectedTeam}
                data-testid="btn-submit-pick">
                {saving ? 'Saving…' : 'Submit Pick'}
              </button>
            </div>
            {msg && <p className={msg.includes('!') ? 'success' : 'error'} role="status"
              aria-live="polite" data-testid="pick-message">{msg}</p>}
          </div>
        )}

        {/* Standings */}
        <div className="card" data-testid="standings-panel">
          <h2>Standings</h2>
          <table aria-label="Game standings">
            <thead><tr><th>Player</th><th>Status</th></tr></thead>
            <tbody>
              {standings.map((s, i) => (
                <tr key={i} data-testid={`standing-row-${s.playerName.replace(/\s+/g,'-')}`}>
                  <td>{s.playerName}</td>
                  <td>
                    <span className={`badge ${s.isActive ? 'badge-active' : 'badge-eliminated'}`}
                      data-testid={`badge-standing-${s.playerName.replace(/\s+/g,'-')}`}>
                      {s.isActive ? 'Active' : `Out (R${s.eliminatedInRound})`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="page-my-games">
      <h2 style={{ marginBottom: '1rem', fontWeight: 600 }}>My Games</h2>
      {games.length === 0 ? (
        <div className="empty">You haven't been added to any games yet.</div>
      ) : (
        games.map(g => (
          <div key={g.id} className="card" style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/my-games/${g.id}`)}
            data-testid={`my-game-card-${g.id}`}
            role="button" aria-label={`Open game ${g.name}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 500 }}>{g.name}</span>
              <span className={`badge ${g.status === 'active' ? 'badge-active' : 'badge-completed'}`}
                data-testid={`badge-my-game-status-${g.id}`}>{g.status}</span>
              <span className={`badge ${g.isActive ? 'badge-active' : 'badge-eliminated'}`}
                data-testid={`badge-my-status-${g.id}`}>
                {g.isActive ? 'Still In' : g.eliminatedInRound ? `Out R${g.eliminatedInRound}` : 'Out'}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                {g.groupName} · Round {g.currentRound}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
