import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { GameWithDetails, Participant, Round, Pick, Team } from '../../types'

type PickResult = 'win' | 'loss' | 'draw' | 'postponed'

export default function GameDetailTab() {
  const { id } = useParams<{ id: string }>()
  const gameId = Number(id)
  const navigate = useNavigate()

  const [game, setGame] = useState<GameWithDetails | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [rounds, setRounds] = useState<Round[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [usedTeams, setUsedTeams] = useState<Record<string, number[]>>({})
  const [loading, setLoading] = useState(true)
  const [revealing, setRevealing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [pendingPicks, setPendingPicks] = useState<Record<string, number | null>>({})
  const [pendingResults, setPendingResults] = useState<Record<number, PickResult>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const loadGame = useCallback(async () => {
    try {
      const [gameRes, usedRes] = await Promise.all([
        api.get<{ game: GameWithDetails; participants: Participant[]; rounds: Round[] }>(`/games/${gameId}`),
        api.get<{ usedTeams: Record<string, number[]> }>(`/games/${gameId}/used-teams`),
      ])
      setGame(gameRes.game)
      setParticipants(gameRes.participants)
      setRounds(gameRes.rounds)
      setUsedTeams(usedRes.usedTeams ?? {})
    } catch {
      navigate('/games')
    }
  }, [gameId, navigate])

  useEffect(() => {
    loadGame().finally(() => setLoading(false))
  }, [loadGame])

  const openRound = rounds.find(r => r.status === 'open')
  const closedRounds = rounds.filter(r => r.status === 'closed')

  useEffect(() => {
    if (!game) return
    api.get<{ teams: Team[] }>(`/groups/${game.groupId}/teams`).then(r => setTeams(r.teams ?? []))
  }, [game])

  useEffect(() => {
    if (!openRound) return
    api.get<{ picks: Pick[] }>(`/rounds/${openRound.id}/picks`).then(r => {
      const p = r.picks ?? []
      setPicks(p)
      const map: Record<string, number | null> = {}
      p.forEach(pick => { map[pick.playerName] = pick.teamId ?? null })
      setPendingPicks(map)
    })
  }, [openRound?.id])

  async function savePicks() {
    if (!openRound) return
    setSaving(true)
    setMsg('')
    try {
      await api.post(`/rounds/${openRound.id}/picks`, {
        picks: Object.entries(pendingPicks).map(([playerName, teamId]) => ({ playerName, teamId }))
      })
      setMsg('Picks saved')
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to save picks')
    } finally {
      setSaving(false)
    }
  }

  async function finalizePicks() {
    if (!openRound) return
    setSaving(true)
    setMsg('')
    try {
      const res = await api.post<{ missingCount: number }>(`/rounds/${openRound.id}/finalize-picks`, {})
      setMsg(`Picks finalised. Auto-assigned: ${res.missingCount}`)
      loadGame()
      api.get<{ picks: Pick[] }>(`/rounds/${openRound.id}/picks`).then(r => {
        setPicks(r.picks ?? [])
        const map: Record<string, number | null> = {}
        ;(r.picks ?? []).forEach(p => { map[p.playerName] = p.teamId ?? null })
        setPendingPicks(map)
      })
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to finalize picks')
    } finally {
      setSaving(false)
    }
  }

  async function saveResults() {
    if (!openRound) return
    setSaving(true)
    setMsg('')
    try {
      await api.post(`/rounds/${openRound.id}/results`, {
        results: Object.entries(pendingResults).map(([pickId, result]) => ({
          pickId: Number(pickId), result
        }))
      })
      setMsg('Results saved')
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to save results')
    } finally {
      setSaving(false)
    }
  }

  async function closeRound() {
    if (!openRound) return
    setSaving(true)
    try {
      await api.post(`/rounds/${openRound.id}/close`, {})
      loadGame()
    } finally {
      setSaving(false)
    }
  }

  async function advanceRound() {
    setSaving(true)
    setMsg('')
    try {
      const res = await api.post<{ status?: string; winnerName?: string; roundNumber?: number; rollover?: string }>(`/games/${gameId}/advance`, {})
      if (res.status === 'completed') {
        setMsg(`Game complete! Winner: ${res.winnerName}`)
      } else if (res.rollover) {
        setMsg(`Rollover! Game reset to round 1.`)
      } else {
        setMsg(`Advanced to round ${res.roundNumber}`)
      }
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to advance round')
    } finally {
      setSaving(false)
    }
  }

  async function reopenRound(roundId: number) {
    setSaving(true)
    try {
      await api.post(`/rounds/${roundId}/reopen`, {})
      loadGame()
    } finally {
      setSaving(false)
    }
  }

  async function deleteGame() {
    try {
      await api.delete(`/games/${gameId}`)
      navigate('/games')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to delete game')
    }
  }

  function getAvailableTeams(playerName: string): Team[] {
    const used = new Set(usedTeams[playerName] ?? [])
    return teams.filter(t => !used.has(t.id))
  }

  // Group picks by team for result entry
  const picksByTeam = picks.reduce<Record<number, Pick[]>>((acc, p) => {
    if (p.teamId) {
      if (!acc[p.teamId]) acc[p.teamId] = []
      acc[p.teamId].push(p)
    }
    return acc
  }, {})

  const allPicksHaveTeam = picks.length > 0 && participants
    .filter(p => p.isActive)
    .every(p => picks.find(pk => pk.playerName === p.playerName && pk.teamId))

  const allResultsEntered = allPicksHaveTeam &&
    picks.filter(p => p.teamId).every(p => pendingResults[p.id] || p.result)

  if (loading) return <div className="empty">Loading…</div>
  if (!game) return null

  return (
    <div data-testid="page-game-detail">
      {/* Header */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/games')}
            data-testid="btn-back-to-games" aria-label="Back to games list">← Back</button>
          <div style={{ flex: 1 }}>
            <h2 style={{ marginBottom: '0.25rem' }}>{game.name}</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className={`badge ${game.status === 'active' ? 'badge-active' : 'badge-completed'}`}
                data-testid="badge-game-status">{game.status}</span>
              <span className="badge badge-closed" data-testid="badge-pick-mode">{game.pickMode} picks</span>
              <span className="badge badge-closed">{game.groupName}</span>
              <span className="badge badge-closed">{game.winnerMode} winner</span>
              <span className="badge badge-closed">rollover: {game.rolloverMode}</span>
              {game.postponeAsWin && <span className="badge badge-open">postpone=win</span>}
            </div>
            {game.winnerName && (
              <p style={{ color: '#22c55e', marginTop: '0.5rem' }} data-testid="game-winner">
                🏆 Winner: {game.winnerName}
              </p>
            )}
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}
            data-testid="btn-delete-game" aria-label="Delete this game">Delete Game</button>
        </div>
      </div>

      {msg && <p className="success" role="status" aria-live="polite" data-testid="game-message">{msg}</p>}

      {/* Participants */}
      <div className="card">
        <h2>Participants ({participants.filter(p => p.isActive).length} active)</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}
          data-testid="participants-list" aria-label="Participants">
          {participants.map(p => (
            <span key={p.id}
              className={`badge ${p.isActive ? 'badge-active' : 'badge-eliminated'}`}
              data-testid={`participant-${p.id}`}
              aria-label={`${p.playerName} ${p.isActive ? 'active' : `eliminated round ${p.eliminatedInRound}`}`}>
              {p.playerName}
              {!p.isActive && p.eliminatedInRound && ` (R${p.eliminatedInRound})`}
            </span>
          ))}
        </div>
      </div>

      {/* Open Round: Picks */}
      {openRound && game.status === 'active' && (
        <div className="card" data-testid="open-round-panel">
          <h2>Round {openRound.roundNumber} — Picks</h2>

          {game.pickMode === 'player' && (
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Players submit their own picks. You can still assign picks for players without accounts.
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm"
              onMouseDown={() => setRevealing(true)} onMouseUp={() => setRevealing(false)}
              onMouseLeave={() => setRevealing(false)} onTouchStart={() => setRevealing(true)} onTouchEnd={() => setRevealing(false)}
              data-testid="btn-reveal-picks" aria-label="Hold to reveal picks">
              👁 Hold to Reveal
            </button>
          </div>

          <table aria-label="Round picks" data-testid="picks-table">
            <thead><tr><th>Player</th><th>Pick</th><th>Status</th></tr></thead>
            <tbody>
              {participants.filter(p => p.isActive).map(p => {
                const available = getAvailableTeams(p.playerName)
                const currentPick = pendingPicks[p.playerName] ?? null
                const pick = picks.find(pk => pk.playerName === p.playerName)
                return (
                  <tr key={p.id} data-testid={`pick-row-${p.playerName.replace(/\s+/g,'-')}`}>
                    <td>{p.playerName}</td>
                    <td>
                      {revealing ? (
                        <select
                          value={currentPick ?? ''}
                          onChange={e => setPendingPicks(prev => ({ ...prev, [p.playerName]: e.target.value ? Number(e.target.value) : null }))}
                          data-testid={`select-pick-${p.playerName.replace(/\s+/g,'-')}`}
                          aria-label={`Pick for ${p.playerName}`}
                        >
                          <option value="">— no pick —</option>
                          {available.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : (
                        <span data-testid={`masked-pick-${p.playerName.replace(/\s+/g,'-')}`}>
                          {currentPick ? '• • • • • • •' : '—'}
                        </span>
                      )}
                    </td>
                    <td>{pick?.autoAssigned && <span className="badge badge-open">auto</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={savePicks} disabled={saving}
              data-testid="btn-save-picks">Save Picks</button>
            <button className="btn btn-secondary" onClick={finalizePicks} disabled={saving}
              data-testid="btn-finalize-picks">Finalize Picks</button>
          </div>

          {/* Results entry (shown when all picks have teams) */}
          {allPicksHaveTeam && (
            <div style={{ marginTop: '1.5rem' }} data-testid="results-panel">
              <h3>Enter Results</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                {Object.entries(picksByTeam).map(([teamIdStr, teamPicks]) => {
                  const teamId = Number(teamIdStr)
                  const teamName = teams.find(t => t.id === teamId)?.name ?? teamId
                  const currentResult = pendingResults[teamPicks[0].id] ?? teamPicks[0].result
                  return (
                    <div key={teamId} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
                      data-testid={`result-row-${teamId}`}>
                      <span style={{ minWidth: '140px', fontWeight: 500 }}>{teamName}</span>
                      <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                        ({teamPicks.map(p => p.playerName).join(', ')})
                      </span>
                      {(['win','loss','draw','postponed'] as PickResult[]).map(r => (
                        <button key={r}
                          className={`result-btn ${currentResult === r ? r : ''}`}
                          onClick={() => {
                            const update: Record<number, PickResult> = {}
                            teamPicks.forEach(p => { update[p.id] = r })
                            setPendingResults(prev => ({ ...prev, ...update }))
                          }}
                          data-testid={`btn-result-${r}-${teamId}`}
                          aria-label={`Set ${teamName} result to ${r}`}
                          aria-pressed={currentResult === r}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveResults} disabled={saving}
                  data-testid="btn-save-results">Save Results</button>
                {allResultsEntered && (
                  <button className="btn btn-secondary" onClick={closeRound} disabled={saving}
                    data-testid="btn-close-round">Close Round</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Closed rounds */}
      {closedRounds.length > 0 && (
        <div className="card" data-testid="closed-rounds-panel">
          <h2>Closed Rounds</h2>
          {closedRounds.map(r => (
            <div key={r.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '6px' }}
              data-testid={`closed-round-${r.id}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontWeight: 500 }}>Round {r.roundNumber}</span>
                <span className="badge badge-closed">closed</span>
                <span style={{ flex: 1 }} />
                {game.status === 'active' && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => reopenRound(r.id)}
                      data-testid={`btn-reopen-round-${r.id}`} aria-label={`Reopen round ${r.roundNumber}`}>
                      Reopen
                    </button>
                    {r.id === closedRounds[closedRounds.length - 1].id && !openRound && (
                      <button className="btn btn-primary btn-sm" onClick={advanceRound} disabled={saving}
                        data-testid="btn-advance-round">Next Round</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-game-title">
          <div className="modal" data-testid="modal-delete-game">
            <h2 id="delete-game-title">Delete Game</h2>
            <p>Delete "{game.name}"? This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}
                data-testid="btn-cancel-delete-game">Cancel</button>
              <button className="btn btn-danger" onClick={deleteGame}
                data-testid="btn-confirm-delete-game">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
