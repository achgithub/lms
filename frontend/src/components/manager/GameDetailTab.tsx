import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { GameWithDetails, Participant, Round, Pick, Team, FixtureRow } from '../../types'

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

  // picks: unified string "" | "t:{teamId}" | "f:{fixtureId}:home|away"
  const [pendingPicks, setPendingPicks] = useState<Record<string, string>>({})
  const [pendingResults, setPendingResults] = useState<Record<number, PickResult>>({})

  // round scope
  const [roundScope, setRoundScope] = useState<FixtureRow[]>([])
  const [scopeOpen, setScopeOpen] = useState(false)
  const [scopeDateFrom, setScopeDateFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [scopeDateTo, setScopeDateTo] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10)
  })
  const [availableFixtures, setAvailableFixtures] = useState<FixtureRow[]>([])
  const [selectedFixtureIds, setSelectedFixtureIds] = useState<Set<number>>(new Set())
  const [scopeLoading, setScopeLoading] = useState(false)
  const [scopeMsg, setScopeMsg] = useState('')
  const [usedTeamNames, setUsedTeamNames] = useState<Record<string, string[]>>({})
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
    // Load picks
    api.get<{ picks: Pick[] }>(`/rounds/${openRound.id}/picks`).then(r => {
      const p = r.picks ?? []
      setPicks(p)
      const map: Record<string, string> = {}
      p.forEach(pick => {
        if (pick.fixtureId && pick.pickedSide) {
          map[pick.playerName] = `f:${pick.fixtureId}:${pick.pickedSide}`
        } else if (pick.teamId) {
          map[pick.playerName] = `t:${pick.teamId}`
        } else {
          map[pick.playerName] = ''
        }
      })
      setPendingPicks(map)
    })
    // Load round scope
    api.get<{ fixtures: FixtureRow[] }>(`/rounds/${openRound.id}/scope`).then(r => {
      setRoundScope(r.fixtures ?? [])
      setSelectedFixtureIds(new Set((r.fixtures ?? []).map(f => f.id)))
    })
  }, [openRound?.id])

  useEffect(() => {
    if (!game) return
    // Load used team names alongside team IDs
    api.get<{ usedTeams: Record<string, number[]>; usedTeamNames?: Record<string, string[]> }>(
      `/games/${gameId}/used-teams`
    ).then(r => {
      setUsedTeamNames(r.usedTeamNames ?? {})
    })
  }, [game, gameId])

  function parsePick(val: string) {
    if (!val) return { teamId: null, fixtureId: null, pickedSide: null }
    if (val.startsWith('t:')) return { teamId: parseInt(val.slice(2)), fixtureId: null, pickedSide: null }
    if (val.startsWith('f:')) {
      const parts = val.split(':')
      return { teamId: null, fixtureId: parseInt(parts[1]), pickedSide: parts[2] }
    }
    return { teamId: null, fixtureId: null, pickedSide: null }
  }

  async function savePicks() {
    if (!openRound) return
    setSaving(true)
    setMsg('')
    try {
      await api.post(`/rounds/${openRound.id}/picks`, {
        picks: Object.entries(pendingPicks).map(([playerName, val]) => ({ playerName, ...parsePick(val) }))
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

  async function searchScopeFixtures() {
    setScopeLoading(true)
    try {
      const r = await api.get<{ fixtures: FixtureRow[] }>(`/fixtures/by-date?dateFrom=${scopeDateFrom}&dateTo=${scopeDateTo}`)
      setAvailableFixtures(r.fixtures ?? [])
    } finally {
      setScopeLoading(false)
    }
  }

  async function saveScope() {
    if (!openRound) return
    setScopeLoading(true)
    setScopeMsg('')
    try {
      await api.post(`/rounds/${openRound.id}/scope`, { fixtureIds: [...selectedFixtureIds] })
      const r = await api.get<{ fixtures: FixtureRow[] }>(`/rounds/${openRound.id}/scope`)
      setRoundScope(r.fixtures ?? [])
      setScopeMsg(`Scope saved — ${r.fixtures?.length ?? 0} fixtures in this round.`)
      setScopeOpen(false)
    } catch (e: unknown) {
      setScopeMsg(e instanceof Error ? e.message : 'Failed to save scope')
    } finally {
      setScopeLoading(false)
    }
  }

  function toggleFixture(id: number) {
    setSelectedFixtureIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function isTeamNameUsed(teamName: string, playerName: string): boolean {
    return (usedTeamNames[playerName] ?? []).some(n => n.toLowerCase() === teamName.toLowerCase())
  }

  function formatFixtureDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  function getAvailableTeams(playerName: string): Team[] {
    const used = new Set(usedTeams[playerName] ?? [])
    return teams.filter(t => !used.has(t.id))
  }

  // Group picks by team for result entry — key is teamId or "f:{fixtureId}:{side}"
  const picksByTeam = picks.reduce<Record<string, Pick[]>>((acc, p) => {
    const key = p.fixtureId ? `f:${p.fixtureId}:${p.pickedSide}` : p.teamId ? String(p.teamId) : null
    if (key) {
      if (!acc[key]) acc[key] = []
      acc[key].push(p)
    }
    return acc
  }, {})

  const allPicksHaveTeam = picks.length > 0 && participants
    .filter(p => p.isActive)
    .every(p => picks.find(pk => pk.playerName === p.playerName && (pk.teamId || pk.fixtureId)))

  const allResultsEntered = allPicksHaveTeam &&
    picks.filter(p => p.teamId || p.fixtureId).every(p => pendingResults[p.id] || p.result)

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

          {/* Round Scope — collapsible */}
          <div style={{ marginBottom: '1rem', border: '1px solid #e2e8f0', borderRadius: '6px' }}
            data-testid="round-scope-panel">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setScopeOpen(p => !p); if (!scopeOpen && availableFixtures.length === 0) searchScopeFixtures() }}
              data-testid="btn-toggle-scope"
              aria-expanded={scopeOpen}
              style={{ width: '100%', textAlign: 'left', borderRadius: '6px', padding: '0.5rem 0.75rem' }}
            >
              📅 Round Scope {roundScope.length > 0 ? `(${roundScope.length} fixture${roundScope.length !== 1 ? 's' : ''})` : '— click to set'}
            </button>

            {scopeOpen && (
              <div style={{ padding: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>From</label>
                    <input type="date" value={scopeDateFrom} onChange={e => setScopeDateFrom(e.target.value)}
                      data-testid="input-scope-date-from" style={{ padding: '0.3rem 0.5rem' }} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>To</label>
                    <input type="date" value={scopeDateTo} onChange={e => setScopeDateTo(e.target.value)}
                      data-testid="input-scope-date-to" style={{ padding: '0.3rem 0.5rem' }} />
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={searchScopeFixtures}
                    disabled={scopeLoading} data-testid="btn-search-scope-fixtures">
                    {scopeLoading ? 'Loading…' : 'Search'}
                  </button>
                </div>

                {availableFixtures.length === 0 && !scopeLoading && (
                  <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                    No fixtures found. Import them first on the Fixtures tab.
                  </p>
                )}

                {availableFixtures.length > 0 && (
                  <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '0.75rem' }}>
                    <table style={{ width: '100%', fontSize: '0.8rem' }} data-testid="scope-fixture-list">
                      <tbody>
                        {availableFixtures.map(f => {
                          const checked = selectedFixtureIds.has(f.id)
                          const d = new Date(f.matchDate)
                          return (
                            <tr key={f.id} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}
                              onClick={() => toggleFixture(f.id)}
                              data-testid={`scope-fixture-${f.id}`}>
                              <td style={{ padding: '0.35rem 0.4rem', width: '28px' }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleFixture(f.id)}
                                  onClick={e => e.stopPropagation()} />
                              </td>
                              <td style={{ padding: '0.35rem 0.4rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                                {' '}{d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td style={{ padding: '0.35rem 0.4rem', fontWeight: 500 }}>{f.homeTeam}</td>
                              <td style={{ padding: '0.35rem 0.4rem', color: '#94a3b8' }}>vs</td>
                              <td style={{ padding: '0.35rem 0.4rem', fontWeight: 500 }}>{f.awayTeam}</td>
                              <td style={{ padding: '0.35rem 0.4rem', color: '#64748b', fontSize: '0.75rem' }}>{f.competitionName}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={saveScope}
                    disabled={scopeLoading} data-testid="btn-save-scope">
                    Save Scope ({selectedFixtureIds.size} selected)
                  </button>
                  {scopeMsg && <span style={{ fontSize: '0.85rem', color: '#22c55e' }}>{scopeMsg}</span>}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm"
              onClick={() => setRevealing(prev => !prev)}
              data-testid="btn-reveal-picks" aria-label="Toggle pick visibility"
              aria-pressed={revealing}>
              {revealing ? '🔒 Hide Picks' : '👁 Reveal Picks'}
            </button>
          </div>

          <table aria-label="Round picks" data-testid="picks-table">
            <thead><tr><th>Player</th><th>Pick</th><th>Status</th></tr></thead>
            <tbody>
              {participants.filter(p => p.isActive).map(p => {
                const available = getAvailableTeams(p.playerName)
                const currentPick = pendingPicks[p.playerName] ?? ''
                const pick = picks.find(pk => pk.playerName === p.playerName)
                const slug = p.playerName.replace(/\s+/g, '-')
                return (
                  <tr key={p.id} data-testid={`pick-row-${slug}`}>
                    <td>{p.playerName}</td>
                    <td>
                      {/* Always render select to prevent layout shift; overlay masks it when hidden */}
                      <div style={{ position: 'relative', display: 'inline-block', minWidth: '200px' }}>
                        <select
                          value={currentPick}
                          onChange={e => setPendingPicks(prev => ({ ...prev, [p.playerName]: e.target.value }))}
                          data-testid={`select-pick-${slug}`}
                          aria-label={`Pick for ${p.playerName}`}
                          style={{ width: '100%' }}
                        >
                          <option value="">— no pick —</option>
                          {roundScope.length > 0
                            ? roundScope.map(f => [
                                <option key={`f:${f.id}:home`} value={`f:${f.id}:home`}
                                  disabled={isTeamNameUsed(f.homeTeam, p.playerName)}>
                                  {f.homeTeam} (vs {f.awayTeam} · {formatFixtureDate(f.matchDate)}){isTeamNameUsed(f.homeTeam, p.playerName) ? ' ✓ used' : ''}
                                </option>,
                                <option key={`f:${f.id}:away`} value={`f:${f.id}:away`}
                                  disabled={isTeamNameUsed(f.awayTeam, p.playerName)}>
                                  {f.awayTeam} (vs {f.homeTeam} · {formatFixtureDate(f.matchDate)}){isTeamNameUsed(f.awayTeam, p.playerName) ? ' ✓ used' : ''}
                                </option>
                              ])
                            : available.map(t => <option key={`t:${t.id}`} value={`t:${t.id}`}>{t.name}</option>)
                          }
                        </select>
                        {!revealing && (
                          <div
                            data-testid={`masked-pick-${slug}`}
                            style={{
                              position: 'absolute', inset: 0,
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              display: 'flex', alignItems: 'center',
                              padding: '0 0.5rem',
                              fontSize: '0.875rem',
                              color: '#94a3b8',
                              cursor: 'default',
                            }}
                          >
                            {currentPick ? '• • • • • • •' : '—'}
                          </div>
                        )}
                      </div>
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
                {Object.entries(picksByTeam).map(([key, teamPicks]) => {
                  const teamName = teamPicks[0].teamName || key
                  const currentResult = pendingResults[teamPicks[0].id] ?? teamPicks[0].result
                  return (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
                      data-testid={`result-row-${key}`}>
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
                          data-testid={`btn-result-${r}-${key}`}
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
