import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { GameWithDetails, Participant, Round, Pick, Team, FixtureRow } from '../../types'

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
  const [checkingResults, setCheckingResults] = useState(false)
  const [manualScores, setManualScores] = useState<Record<number, { home: string; away: string; status: string }>>({})

  const loadGame = useCallback(async () => {
    try {
      const [gameRes, usedRes] = await Promise.all([
        api.get<{ game: GameWithDetails; participants: Participant[]; rounds: Round[] }>(`/games/${gameId}`),
        api.get<{ usedTeams: Record<string, number[]>; usedTeamNames?: Record<string, string[]> }>(`/games/${gameId}/used-teams`),
      ])
      setGame(gameRes.game)
      setParticipants(gameRes.participants)
      setRounds(gameRes.rounds)
      setUsedTeams(usedRes.usedTeams ?? {})
      setUsedTeamNames(usedRes.usedTeamNames ?? {})
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

  async function reloadRoundData(roundId: number) {
    const [picksRes, scopeRes] = await Promise.all([
      api.get<{ picks: Pick[] }>(`/rounds/${roundId}/picks`),
      api.get<{ fixtures: FixtureRow[] }>(`/rounds/${roundId}/scope`),
    ])
    const p = picksRes.picks ?? []
    setPicks(p)
    const map: Record<string, string> = {}
    p.forEach(pick => {
      if (pick.fixtureId && pick.pickedSide) map[pick.playerName] = `f:${pick.fixtureId}:${pick.pickedSide}`
      else if (pick.teamId) map[pick.playerName] = `t:${pick.teamId}`
      else map[pick.playerName] = ''
    })
    setPendingPicks(map)
    const scope = scopeRes.fixtures ?? []
    setRoundScope(scope)
    setSelectedFixtureIds(new Set(scope.map(f => f.id)))
  }

  useEffect(() => {
    if (!openRound) return
    reloadRoundData(openRound.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRound?.id])

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
      await reloadRoundData(openRound.id)
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to finalize picks')
    } finally {
      setSaving(false)
    }
  }

  async function checkForResults() {
    if (!openRound) return
    setCheckingResults(true)
    setMsg('')
    try {
      const codes = [...new Set(roundScope.map(f => f.competitionCode))]
      await Promise.all(codes.map(code => api.post(`/fixtures/update-results?code=${code}`, {})))
      await reloadRoundData(openRound.id)
      setMsg('Results refreshed from API')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to check results')
    } finally {
      setCheckingResults(false)
    }
  }

  async function setManualResult(fixtureId: number) {
    const ms = manualScores[fixtureId]
    if (!ms) return
    const needsScores = !['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(ms.status)
    if (needsScores && (ms.home === '' || ms.away === '')) {
      setMsg('Enter both home and away scores before setting the result')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const homeScore = ms.home !== '' ? parseInt(ms.home) : null
      const awayScore = ms.away !== '' ? parseInt(ms.away) : null
      await api.put(`/fixtures/${fixtureId}/result`, {
        homeScore,
        awayScore,
        status: ms.status || 'FINISHED',
      })
      if (openRound) await reloadRoundData(openRound.id)
      setMsg('Score set')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to set score')
    } finally {
      setSaving(false)
    }
  }

  async function applyResults() {
    if (!openRound) return
    setSaving(true)
    setMsg('')
    try {
      await api.post(`/rounds/${openRound.id}/apply-results`, {})
      await reloadRoundData(openRound.id)
      await loadGame()
      setMsg('Results confirmed')
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to apply results')
    } finally {
      setSaving(false)
    }
  }

  async function saveResults(pendingResults: Record<number, string>) {
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
      await reloadRoundData(openRound.id)
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
      const res = await api.post<{ roundNumber?: number }>(`/games/${gameId}/advance`, {})
      setMsg(`Advanced to round ${res.roundNumber}`)
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to advance round')
    } finally {
      setSaving(false)
    }
  }

  async function declareWinners() {
    setSaving(true)
    setMsg('')
    try {
      const res = await api.post<{ winnerName?: string }>(`/games/${gameId}/declare-winners`, {})
      setMsg(`Winners declared: ${res.winnerName}`)
      loadGame()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed to declare winners')
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

  function fixtureResultLabel(f: FixtureRow, side: 'home' | 'away') {
    if (['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(f.status)) {
      return game?.postponeAsWin
        ? { label: '✅ WIN (postponed)', color: '#22c55e' }
        : { label: '🔄 postponed', color: '#94a3b8' }
    }
    if (f.status !== 'FINISHED' || f.homeScore === null || f.awayScore === null) return null
    if (f.homeScore === f.awayScore) return { label: '🤝 draw', color: '#f59e0b' }
    const homeWon = f.homeScore > f.awayScore
    if ((side === 'home' && homeWon) || (side === 'away' && !homeWon)) {
      return { label: '✅ WIN', color: '#22c55e' }
    }
    return { label: '❌ LOSS', color: '#ef4444' }
  }

  // Group picks by team/fixture for results display
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

  // Only fixtures where at least one player made a pick
  const scopeWithPicks = roundScope.filter(f =>
    (picksByTeam[`f:${f.id}:home`] ?? []).length > 0 ||
    (picksByTeam[`f:${f.id}:away`] ?? []).length > 0
  )

  const allFixturesSettled = scopeWithPicks.length > 0 &&
    scopeWithPicks.every(f => ['FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(f.status))

  const allPicksHaveResults = picks.length > 0 &&
    picks.filter(p => p.teamId || p.fixtureId).every(p => !!p.result)

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
              <span className="badge badge-closed">{game.groupName}</span>
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

      {/* Open Round */}
      {openRound && game.status === 'active' && (
        <div className="card" data-testid="open-round-panel">
          <h2>Round {openRound.roundNumber} — Picks</h2>

          {/* Round Scope */}
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
                  <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setSelectedFixtureIds(new Set(availableFixtures.map(f => f.id)))}
                      data-testid="btn-select-all-fixtures">Select All</button>
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setSelectedFixtureIds(new Set())}
                      data-testid="btn-deselect-all-fixtures">Deselect All</button>
                  </div>
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

          {/* Reveal toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button className="btn btn-secondary btn-sm"
              onClick={() => setRevealing(prev => !prev)}
              data-testid="btn-reveal-picks" aria-label="Toggle pick visibility"
              aria-pressed={revealing}>
              {revealing ? '🔒 Hide Picks' : '👁 Reveal Picks'}
            </button>
          </div>

          {/* Picks table */}
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
                      <div style={{ position: 'relative', display: 'inline-block', minWidth: '200px' }}>
                        <select
                          value={currentPick}
                          onChange={e => setPendingPicks(prev => ({ ...prev, [p.playerName]: e.target.value }))}
                          data-testid={`select-pick-${slug}`}
                          aria-label={`Pick for ${p.playerName}`}
                          style={{ width: '100%' }}
                        >
                          <option value="">— no pick —</option>
                          {roundScope.map(f => [
                            <option key={`f:${f.id}:home`} value={`f:${f.id}:home`}
                              disabled={isTeamNameUsed(f.homeTeam, p.playerName)}>
                              {f.homeTeam} (vs {f.awayTeam} · {formatFixtureDate(f.matchDate)}){isTeamNameUsed(f.homeTeam, p.playerName) ? ' ✓ used' : ''}
                            </option>,
                            <option key={`f:${f.id}:away`} value={`f:${f.id}:away`}
                              disabled={isTeamNameUsed(f.awayTeam, p.playerName)}>
                              {f.awayTeam} (vs {f.homeTeam} · {formatFixtureDate(f.matchDate)}){isTeamNameUsed(f.awayTeam, p.playerName) ? ' ✓ used' : ''}
                            </option>
                          ])}
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
                    <td>
                      {pick?.autoAssigned && <span className="badge badge-open">auto</span>}
                      {pick?.result && (
                        <span className={`badge badge-${pick.result === 'win' ? 'active' : pick.result === 'loss' ? 'eliminated' : 'closed'}`}>
                          {pick.result}
                        </span>
                      )}
                    </td>
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

          {/* Fixture-based results panel */}
          {allPicksHaveTeam && scopeWithPicks.length > 0 && (
            <FixtureResultsPanel
              roundScope={scopeWithPicks}
              picksByTeam={picksByTeam}
              manualScores={manualScores}
              setManualScores={setManualScores}
              checkingResults={checkingResults}
              saving={saving}
              allFixturesSettled={allFixturesSettled}
              allPicksHaveResults={allPicksHaveResults}
              postponeAsWin={game.postponeAsWin}
              onCheckResults={checkForResults}
              onSetManualResult={setManualResult}
              onApplyResults={applyResults}
              onCloseRound={closeRound}
              formatFixtureDate={formatFixtureDate}
            />
          )}

          {/* Manual results panel (no scope) */}
          {allPicksHaveTeam && scopeWithPicks.length === 0 && (
            <ManualResultsPanel
              picks={picks}
              picksByTeam={picksByTeam}
              saving={saving}
              onSaveResults={saveResults}
              onCloseRound={closeRound}
            />
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
                      <>
                        <button className="btn btn-primary btn-sm" onClick={advanceRound} disabled={saving}
                          data-testid="btn-advance-round">Next Round</button>
                        <button className="btn btn-secondary btn-sm" onClick={declareWinners} disabled={saving}
                          data-testid="btn-declare-winners">Declare Winners</button>
                      </>
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

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FixtureResultsPanelProps {
  roundScope: FixtureRow[]
  picksByTeam: Record<string, Pick[]>
  manualScores: Record<number, { home: string; away: string; status: string }>
  setManualScores: React.Dispatch<React.SetStateAction<Record<number, { home: string; away: string; status: string }>>>
  checkingResults: boolean
  saving: boolean
  allFixturesSettled: boolean
  allPicksHaveResults: boolean
  postponeAsWin: boolean
  onCheckResults: () => void
  onSetManualResult: (fixtureId: number) => void
  onApplyResults: () => void
  onCloseRound: () => void
  formatFixtureDate: (iso: string) => string
}

function FixtureResultsPanel({
  roundScope, picksByTeam, manualScores, setManualScores,
  checkingResults, saving, allFixturesSettled, allPicksHaveResults, postponeAsWin,
  onCheckResults, onSetManualResult, onApplyResults, onCloseRound, formatFixtureDate
}: FixtureResultsPanelProps) {
  function resultLabel(f: FixtureRow, side: 'home' | 'away') {
    if (['POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(f.status)) {
      return postponeAsWin
        ? { label: '✅ WIN (postponed)', color: '#22c55e' }
        : { label: '🔄 postponed', color: '#94a3b8' }
    }
    if (f.status !== 'FINISHED' || f.homeScore === null || f.awayScore === null) return null
    if (f.homeScore === f.awayScore) return { label: '🤝 draw', color: '#f59e0b' }
    const homeWon = f.homeScore > f.awayScore
    if ((side === 'home' && homeWon) || (side === 'away' && !homeWon)) {
      return { label: '✅ WIN', color: '#22c55e' }
    }
    return { label: '❌ LOSS', color: '#ef4444' }
  }

  return (
    <div style={{ marginTop: '1.5rem' }} data-testid="fixture-results-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Results</h3>
        <button className="btn btn-secondary btn-sm" onClick={onCheckResults}
          disabled={checkingResults} data-testid="btn-check-results">
          {checkingResults ? 'Checking…' : '🔄 Check for Results'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {roundScope.map(f => {
          const homePickers = picksByTeam[`f:${f.id}:home`] ?? []
          const awayPickers = picksByTeam[`f:${f.id}:away`] ?? []
          const settled = ['FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED'].includes(f.status)
          const scoreDisplay = f.homeScore !== null && f.awayScore !== null
            ? `${f.homeScore} – ${f.awayScore}`
            : null
          const homeResult = resultLabel(f, 'home')
          const awayResult = resultLabel(f, 'away')
          const ms = manualScores[f.id] ?? { home: '', away: '', status: 'FINISHED' }

          return (
            <div key={f.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem' }}
              data-testid={`fixture-result-${f.id}`}>

              {/* Match header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{f.homeTeam}</span>
                <span style={{ color: '#64748b' }}>vs</span>
                <span style={{ fontWeight: 600 }}>{f.awayTeam}</span>
                {scoreDisplay && (
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b', padding: '0 0.25rem' }}>
                    {scoreDisplay}
                  </span>
                )}
                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>· {formatFixtureDate(f.matchDate)}</span>
                <span style={{
                  fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px',
                  background: settled ? '#dcfce7' : '#fef3c7',
                  color: settled ? '#166534' : '#92400e',
                  fontWeight: 600
                }}>{f.status}</span>
              </div>

              {/* Pickers by side */}
              <div style={{ display: 'flex', gap: '2rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <PickerList label={f.homeTeam} pickers={homePickers} result={homeResult} />
                <PickerList label={f.awayTeam} pickers={awayPickers} result={awayResult} />
              </div>

              {/* Manual score override */}
              <details style={{ marginTop: '0.25rem' }}>
                <summary style={{ fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                  Set score manually (for testing — a live refresh will overwrite)
                </summary>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                  <input type="number" placeholder="Home" value={ms.home} min="0"
                    onChange={e => setManualScores(prev => ({ ...prev, [f.id]: { ...ms, home: e.target.value } }))}
                    style={{ width: '65px', padding: '0.25rem 0.4rem' }}
                    data-testid={`input-home-score-${f.id}`} />
                  <span style={{ color: '#94a3b8' }}>–</span>
                  <input type="number" placeholder="Away" value={ms.away} min="0"
                    onChange={e => setManualScores(prev => ({ ...prev, [f.id]: { ...ms, away: e.target.value } }))}
                    style={{ width: '65px', padding: '0.25rem 0.4rem' }}
                    data-testid={`input-away-score-${f.id}`} />
                  <select value={ms.status}
                    onChange={e => setManualScores(prev => ({ ...prev, [f.id]: { ...ms, status: e.target.value } }))}
                    style={{ padding: '0.25rem 0.4rem' }}
                    data-testid={`select-status-${f.id}`}>
                    <option value="FINISHED">FINISHED</option>
                    <option value="POSTPONED">POSTPONED</option>
                    <option value="CANCELLED">CANCELLED</option>
                    <option value="SCHEDULED">SCHEDULED</option>
                    <option value="IN_PLAY">IN_PLAY</option>
                  </select>
                  <button className="btn btn-secondary btn-sm" onClick={() => onSetManualResult(f.id)}
                    disabled={saving} data-testid={`btn-set-score-${f.id}`}>
                    Set Score
                  </button>
                </div>
              </details>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {allFixturesSettled && !allPicksHaveResults && (
          <button className="btn btn-primary" onClick={onApplyResults} disabled={saving}
            data-testid="btn-confirm-results">
            Confirm Results
          </button>
        )}
        {allPicksHaveResults && (
          <button className="btn btn-secondary" onClick={onCloseRound} disabled={saving}
            data-testid="btn-close-round">
            Close Round
          </button>
        )}
      </div>
    </div>
  )
}

function PickerList({ label, pickers, result }: {
  label: string
  pickers: Pick[]
  result: { label: string; color: string } | null
}) {
  return (
    <div style={{ minWidth: '140px' }}>
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem', fontWeight: 500 }}>{label}</div>
      {pickers.length > 0
        ? pickers.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem', marginBottom: '0.1rem' }}>
            <span>{p.playerName}</span>
            {result && <span style={{ color: result.color, fontWeight: 600, fontSize: '0.8rem' }}>{result.label}</span>}
          </div>
        ))
        : <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>—</span>
      }
    </div>
  )
}

type PickResult = 'win' | 'loss' | 'draw' | 'postponed'

interface ManualResultsPanelProps {
  picks: Pick[]
  picksByTeam: Record<string, Pick[]>
  saving: boolean
  onSaveResults: (results: Record<number, string>) => void
  onCloseRound: () => void
}

function ManualResultsPanel({ picks, picksByTeam, saving, onSaveResults, onCloseRound }: ManualResultsPanelProps) {
  const [pendingResults, setPendingResults] = useState<Record<number, PickResult>>({})

  const allResultsEntered = picks.filter(p => p.teamId || p.fixtureId).length > 0 &&
    picks.filter(p => p.teamId || p.fixtureId).every(p => pendingResults[p.id] || p.result)

  return (
    <div style={{ marginTop: '1.5rem' }} data-testid="results-panel">
      <h3>Enter Results</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
        {Object.entries(picksByTeam).map(([key, teamPicks]) => {
          const teamName = teamPicks[0].teamName || key
          const currentResult = pendingResults[teamPicks[0].id] ?? teamPicks[0].result as PickResult | undefined
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
              data-testid={`result-row-${key}`}>
              <span style={{ minWidth: '140px', fontWeight: 500 }}>{teamName}</span>
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                ({teamPicks.map(p => p.playerName).join(', ')})
              </span>
              {(['win', 'loss', 'draw', 'postponed'] as PickResult[]).map(r => (
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
        <button className="btn btn-primary" onClick={() => onSaveResults(pendingResults)} disabled={saving}
          data-testid="btn-save-results">Save Results</button>
        {allResultsEntered && (
          <button className="btn btn-secondary" onClick={onCloseRound} disabled={saving}
            data-testid="btn-close-round">Close Round</button>
        )}
      </div>
    </div>
  )
}
