import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { Group, Team, Player } from '../../types'

export default function SetupTab() {
  const [groups, setGroups] = useState<Group[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null)
  const [groupTeams, setGroupTeams] = useState<Record<number, Team[]>>({})

  const [newGroupName, setNewGroupName] = useState('')
  const [newPlayerName, setNewPlayerName] = useState('')
  const [newTeamName, setNewTeamName] = useState<Record<number, string>>({})

  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null)

  useEffect(() => { loadGroups(); loadPlayers() }, [])

  async function loadGroups() {
    const res = await api.get<{ groups: Group[] }>('/groups')
    setGroups(res.groups ?? [])
  }
  async function loadPlayers() {
    const res = await api.get<{ players: Player[] }>('/players')
    setPlayers(res.players ?? [])
  }

  async function loadTeams(groupId: number) {
    const res = await api.get<{ teams: Team[] }>(`/groups/${groupId}/teams`)
    setGroupTeams(prev => ({ ...prev, [groupId]: res.teams ?? [] }))
  }

  function toggleGroup(id: number) {
    if (expandedGroup === id) {
      setExpandedGroup(null)
    } else {
      setExpandedGroup(id)
      if (!groupTeams[id]) loadTeams(id)
    }
  }

  function confirm(message: string, onConfirm: () => void) {
    setConfirmDialog({ message, onConfirm })
  }

  async function createGroup() {
    if (!newGroupName.trim()) return
    await api.post('/groups', { name: newGroupName })
    setNewGroupName('')
    loadGroups()
  }

  async function deleteGroup(id: number) {
    confirm('Delete this group and all its teams?', async () => {
      setConfirmDialog(null)
      await api.delete(`/groups/${id}`)
      loadGroups()
    })
  }

  async function createTeam(groupId: number) {
    const name = newTeamName[groupId]?.trim()
    if (!name) return
    await api.post(`/groups/${groupId}/teams`, { name })
    setNewTeamName(prev => ({ ...prev, [groupId]: '' }))
    loadTeams(groupId)
    loadGroups()
  }

  async function deleteTeam(groupId: number, teamId: number) {
    confirm('Delete this team?', async () => {
      setConfirmDialog(null)
      await api.delete(`/teams/${teamId}`)
      loadTeams(groupId)
      loadGroups()
    })
  }

  async function createPlayer() {
    if (!newPlayerName.trim()) return
    await api.post('/players', { name: newPlayerName })
    setNewPlayerName('')
    loadPlayers()
  }

  async function deletePlayer(id: number) {
    confirm('Remove this player from the pool?', async () => {
      setConfirmDialog(null)
      await api.delete(`/players/${id}`)
      loadPlayers()
    })
  }

  return (
    <div data-testid="page-setup">
      {/* Player Pool */}
      <div className="card">
        <h2>Player Pool</h2>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="new-player-name">Player Name</label>
            <input
              id="new-player-name"
              type="text"
              value={newPlayerName}
              onChange={e => setNewPlayerName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createPlayer()}
              placeholder="Add player…"
              data-testid="input-player-name"
              aria-label="New player name"
            />
          </div>
          <button className="btn btn-primary" onClick={createPlayer} data-testid="btn-add-player">
            Add Player
          </button>
        </div>

        {players.length === 0 ? (
          <p className="empty">No players in pool yet</p>
        ) : (
          <table aria-label="Player pool">
            <thead><tr><th>Name</th><th>Actions</th></tr></thead>
            <tbody>
              {players.map(p => (
                <tr key={p.id} data-testid={`player-row-${p.id}`}>
                  <td>{p.name}{p.userId && <span className="badge badge-player" style={{ marginLeft: '0.5rem' }}>linked</span>}</td>
                  <td>
                    <button className="btn-icon" onClick={() => deletePlayer(p.id)}
                      data-testid={`btn-delete-player-${p.id}`} aria-label={`Remove ${p.name}`}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Groups & Teams */}
      <div className="card">
        <h2>Groups & Teams</h2>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="new-group-name">Group Name</label>
            <input
              id="new-group-name"
              type="text"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createGroup()}
              placeholder="e.g. Premier League 25/26"
              data-testid="input-group-name"
              aria-label="New group name"
            />
          </div>
          <button className="btn btn-primary" onClick={createGroup} data-testid="btn-add-group">
            Add Group
          </button>
        </div>

        {groups.length === 0 ? (
          <p className="empty">No groups yet</p>
        ) : (
          groups.map(g => (
            <div key={g.id} className="card" style={{ marginBottom: '0.5rem' }} data-testid={`group-row-${g.id}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => toggleGroup(g.id)}
                  data-testid={`btn-toggle-group-${g.id}`}
                  aria-expanded={expandedGroup === g.id}
                  aria-label={`${expandedGroup === g.id ? 'Collapse' : 'Expand'} ${g.name}`}
                >
                  {expandedGroup === g.id ? '▲' : '▼'}
                </button>
                <span style={{ fontWeight: 500 }}>{g.name}</span>
                <span className="badge badge-closed">{g.teamCount ?? 0} teams</span>
                <span style={{ flex: 1 }} />
                <button className="btn-icon" onClick={() => deleteGroup(g.id)}
                  data-testid={`btn-delete-group-${g.id}`} aria-label={`Delete group ${g.name}`}>🗑</button>
              </div>

              {expandedGroup === g.id && (
                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                  <div className="form-row">
                    <input
                      type="text"
                      value={newTeamName[g.id] ?? ''}
                      onChange={e => setNewTeamName(prev => ({ ...prev, [g.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && createTeam(g.id)}
                      placeholder="Add team…"
                      data-testid={`input-team-name-${g.id}`}
                      aria-label={`New team for ${g.name}`}
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => createTeam(g.id)}
                      data-testid={`btn-add-team-${g.id}`} aria-label={`Add team to ${g.name}`}>
                      Add Team
                    </button>
                  </div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}
                    data-testid={`team-list-${g.id}`} aria-label={`Teams in ${g.name}`}>
                    {(groupTeams[g.id] ?? []).map(t => (
                      <li key={t.id} data-testid={`team-item-${t.id}`}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                        {t.name}
                        <button className="btn-icon" style={{ fontSize: '0.75rem', padding: '0' }}
                          onClick={() => deleteTeam(g.id, t.id)}
                          data-testid={`btn-delete-team-${t.id}`} aria-label={`Delete team ${t.name}`}>✕</button>
                      </li>
                    ))}
                    {(groupTeams[g.id] ?? []).length === 0 && (
                      <li style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No teams yet</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {confirmDialog && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal" data-testid="modal-confirm">
            <h2 id="confirm-title">Confirm</h2>
            <p>{confirmDialog.message}</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDialog(null)}
                data-testid="btn-cancel-confirm">Cancel</button>
              <button className="btn btn-danger" onClick={confirmDialog.onConfirm}
                data-testid="btn-confirm-action">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
