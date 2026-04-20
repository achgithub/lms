import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { Competition, FootballTeam } from '../../types'

interface FixtureMatch {
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

function statusLabel(status: string) {
  const map: Record<string, string> = {
    SCHEDULED: 'Scheduled', TIMED: 'Scheduled',
    LIVE: 'Live', IN_PLAY: 'Live', PAUSED: 'Live',
    FINISHED: 'Finished', AWARDED: 'Finished',
    POSTPONED: 'Postponed', SUSPENDED: 'Postponed', CANCELLED: 'Cancelled',
  }
  return map[status] ?? status
}

function statusClass(status: string) {
  if (['LIVE','IN_PLAY','PAUSED'].includes(status)) return 'badge-open'
  if (['FINISHED','AWARDED'].includes(status)) return 'badge-closed'
  if (['POSTPONED','SUSPENDED','CANCELLED'].includes(status)) return 'badge-eliminated'
  return 'badge-active'
}

export default function FixturesTab() {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [selectedCode, setSelectedCode] = useState('')
  const [teams, setTeams] = useState<FootballTeam[]>([])
  const [groupName, setGroupName] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [matches, setMatches] = useState<FixtureMatch[]>([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [matchesMsg, setMatchesMsg] = useState('')

  useEffect(() => {
    api.get<{ competitions: Competition[] }>('/fixtures/competitions')
      .then(res => setCompetitions(res.competitions ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load competitions'))
  }, [])

  async function handlePreview() {
    if (!selectedCode) return
    setPreviewing(true)
    setTeams([])
    setError('')
    setSuccess('')
    try {
      const res = await api.get<{ teams: FootballTeam[] }>(`/fixtures/teams?code=${selectedCode}`)
      setTeams(res.teams ?? [])
      const comp = competitions.find(c => c.code === selectedCode)
      if (comp && !groupName) setGroupName(comp.name)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load teams')
    } finally {
      setPreviewing(false)
    }
  }

  function loadMatches(code: string) {
    if (!code) return
    setMatchesLoading(true)
    api.get<{ fixtures: FixtureMatch[] }>(`/fixtures/matches?code=${code}`)
      .then(r => setMatches(r.fixtures ?? []))
      .catch(() => setMatches([]))
      .finally(() => setMatchesLoading(false))
  }

  useEffect(() => {
    if (selectedCode) loadMatches(selectedCode)
    else setMatches([])
  }, [selectedCode])

  async function importMatches() {
    if (!selectedCode) return
    setMatchesLoading(true)
    setMatchesMsg('')
    try {
      const res = await api.post<{ imported: number }>(`/fixtures/import-matches?code=${selectedCode}`, {})
      setMatchesMsg(`Imported ${res.imported} fixtures for the next 28 days.`)
      loadMatches(selectedCode)
    } catch (e: unknown) {
      setMatchesMsg(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setMatchesLoading(false)
    }
  }

  async function updateResults() {
    if (!selectedCode) return
    setMatchesLoading(true)
    setMatchesMsg('')
    try {
      const res = await api.post<{ updated: number }>(`/fixtures/update-results?code=${selectedCode}`, {})
      setMatchesMsg(`Updated results for ${res.updated} matches.`)
      loadMatches(selectedCode)
    } catch (e: unknown) {
      setMatchesMsg(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setMatchesLoading(false)
    }
  }

  async function handleImport() {
    if (!groupName || teams.length === 0) return
    setImporting(true)
    setError('')
    try {
      const res = await api.post<{ groupId: number; teamCount: number }>('/fixtures/import', {
        groupName,
        teamNames: teams.map(t => t.name),
        competitionCode: selectedCode,
      })
      setSuccess(`Imported "${groupName}" with ${res.teamCount} teams as a new group.`)
      setTeams([])
      setGroupName('')
      setSelectedCode('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div data-testid="page-fixtures">
      <div className="card">
        <h2>Import Fixture Data</h2>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Select a competition to load its teams and create a new group automatically.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="select-competition">Competition</label>
            <select
              id="select-competition"
              value={selectedCode}
              onChange={e => { setSelectedCode(e.target.value); setTeams([]) }}
              data-testid="select-competition"
              aria-label="Select competition"
              style={{ minWidth: '220px' }}
              disabled={loading}
            >
              <option value="">— select a competition —</option>
              {competitions.map(c => (
                <option key={c.code} value={c.code}>{c.name} ({c.area?.name})</option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-secondary"
            onClick={handlePreview}
            disabled={!selectedCode || previewing}
            data-testid="btn-preview-fixtures"
            aria-label="Preview teams for selected competition"
          >
            {previewing ? 'Loading…' : 'Preview Teams'}
          </button>
        </div>

        {error && <p className="error" role="alert" data-testid="fixtures-error">{error}</p>}
        {success && <p className="success" role="status" data-testid="fixtures-success">{success}</p>}
      </div>

      {/* Match Fixtures section */}
      {selectedCode && (
        <div className="card" data-testid="match-fixtures-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Match Fixtures</h2>
            <button className="btn btn-primary btn-sm" onClick={importMatches}
              disabled={matchesLoading} data-testid="btn-import-matches"
              aria-label="Import next 28 days of fixtures">
              {matchesLoading ? 'Loading…' : '↓ Import Next 28 Days'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={updateResults}
              disabled={matchesLoading} data-testid="btn-update-results"
              aria-label="Update results for recent matches">
              ↻ Update Results
            </button>
          </div>

          {matchesMsg && <p className="success" role="status" data-testid="matches-msg">{matchesMsg}</p>}

          {matches.length === 0 && !matchesLoading && (
            <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
              No fixtures stored for this competition. Click "Import Next 28 Days" to fetch from the API.
            </p>
          )}

          {matches.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table aria-label="Fixtures" data-testid="fixtures-table" style={{ width: '100%', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Date</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Home</th>
                    <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Score</th>
                    <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Away</th>
                    <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map(m => {
                    const d = new Date(m.matchDate)
                    const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                    const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                    const finished = m.homeScore !== null && m.awayScore !== null
                    return (
                      <tr key={m.id} data-testid={`fixture-row-${m.apiMatchId}`}
                        style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', color: '#64748b' }}>
                          {dateStr}<br /><span style={{ fontSize: '0.8rem' }}>{timeStr}</span>
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>{m.homeTeam}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 700, minWidth: '60px' }}>
                          {finished ? `${m.homeScore} – ${m.awayScore}` : '–'}
                        </td>
                        <td style={{ padding: '0.5rem', fontWeight: 500 }}>{m.awayTeam}</td>
                        <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                          <span className={`badge ${statusClass(m.status)}`} data-testid={`fixture-status-${m.apiMatchId}`}>
                            {statusLabel(m.status)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {teams.length > 0 && (
        <div className="card">
          <h2>Teams Preview ({teams.length})</h2>
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label htmlFor="group-name-input">Group Name</label>
              <input
                id="group-name-input"
                type="text"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                data-testid="input-group-name"
                aria-label="Group name for import"
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleImport}
              disabled={!groupName || importing}
              data-testid="btn-import-group"
              aria-label="Import as new group"
            >
              {importing ? 'Importing…' : 'Import as Group'}
            </button>
          </div>
          <ul
            data-testid="list-fixture-teams"
            aria-label="Teams to import"
            style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
          >
            {teams.map(t => (
              <li key={t.id} data-testid={`fixture-team-${t.id}`}
                style={{ background: '#f1f5f9', padding: '0.3rem 0.7rem', borderRadius: '4px', fontSize: '0.875rem' }}>
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
