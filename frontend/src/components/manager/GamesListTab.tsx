import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { GameWithDetails, Group, Player } from '../../types'

export default function GamesListTab() {
  const navigate = useNavigate()
  const [games, setGames] = useState<GameWithDetails[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [gameName, setGameName] = useState('')
  const [groupId, setGroupId] = useState<number>(0)
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set())
  const [playerSearch, setPlayerSearch] = useState('')
  const [postponeAsWin, setPostponeAsWin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get<{ games: GameWithDetails[] }>('/games'),
      api.get<{ groups: Group[] }>('/groups'),
      api.get<{ players: Player[] }>('/players'),
    ]).then(([g, gr, p]) => {
      setGames(g.games ?? [])
      setGroups(gr.groups ?? [])
      setPlayers(p.players ?? [])
    }).finally(() => setLoading(false))
  }, [])

  const filteredPlayers = players.filter(p =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  )

  function togglePlayer(name: string) {
    setSelectedPlayers(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function selectAll() {
    setSelectedPlayers(new Set(filteredPlayers.map(p => p.name)))
  }

  async function handleCreate() {
    if (!gameName || !groupId || selectedPlayers.size === 0) {
      setCreateError('Name, group, and at least one player are required')
      return
    }
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.post<{ id: number }>('/games', {
        name: gameName, groupId, playerNames: [...selectedPlayers], postponeAsWin,
      })
      navigate(`/games/${res.id}`)
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create game')
      setCreating(false)
    }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <div data-testid="page-games-list">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Games</h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}
          data-testid="btn-toggle-create-game">
          {showCreate ? 'Cancel' : '+ New Game'}
        </button>
      </div>

      {showCreate && (
        <div className="card" data-testid="form-create-game">
          <h2>New Game</h2>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="game-name">Game Name</label>
              <input id="game-name" type="text" value={gameName} onChange={e => setGameName(e.target.value)}
                data-testid="input-game-name" aria-label="Game name" />
            </div>
            <div className="form-group">
              <label htmlFor="game-group">Group</label>
              <select id="game-group" value={groupId} onChange={e => setGroupId(Number(e.target.value))}
                data-testid="select-game-group" aria-label="Select group">
                <option value={0}>— select group —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}>
              <input type="checkbox" checked={postponeAsWin} onChange={e => setPostponeAsWin(e.target.checked)}
                data-testid="checkbox-postpone-as-win" aria-label="Postponed matches count as win" />
              Postponed matches count as win
            </label>
          </div>

          <hr className="divider" />
          <h3>Select Players</h3>
          <div className="form-row" style={{ marginBottom: '0.5rem' }}>
            <input type="text" placeholder="Search players…" value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
              data-testid="input-player-search" aria-label="Search players" />
            <button className="btn btn-secondary btn-sm" onClick={selectAll}
              data-testid="btn-select-all-players">Select All</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedPlayers(new Set())}
              data-testid="btn-deselect-all-players">Deselect All</button>
          </div>
          <div data-testid="player-selection-list" aria-label="Player selection"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            {filteredPlayers.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.875rem',
                background: selectedPlayers.has(p.name) ? '#dbeafe' : '#f1f5f9',
                padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}
                data-testid={`player-checkbox-${p.id}`}>
                <input type="checkbox" checked={selectedPlayers.has(p.name)}
                  onChange={() => togglePlayer(p.name)} aria-label={`Select ${p.name}`} />
                {p.name}
              </label>
            ))}
            {filteredPlayers.length === 0 && <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No players found</span>}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
            {selectedPlayers.size} player(s) selected
          </div>

          {createError && <p className="error" role="alert" data-testid="create-game-error">{createError}</p>}
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}
            data-testid="btn-create-game">
            {creating ? 'Creating…' : 'Create Game'}
          </button>
        </div>
      )}

      {games.length === 0 ? (
        <div className="empty" data-testid="games-empty">No games yet. Create one above.</div>
      ) : (
        games.map(g => (
          <div key={g.id} className="card" style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/games/${g.id}`)}
            data-testid={`game-card-${g.id}`}
            role="button" aria-label={`Open game ${g.name}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 500 }}>{g.name}</span>
              <span className={`badge ${g.status === 'active' ? 'badge-active' : 'badge-completed'}`}
                data-testid={`badge-game-status-${g.id}`}>
                {g.status}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
                {g.groupName} · {g.participantCount} players · Round {g.currentRound}
              </span>
            </div>
            {g.winnerName && (
              <p style={{ color: '#22c55e', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                🏆 {g.winnerName}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  )
}
