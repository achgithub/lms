import { useState, useEffect } from 'react'
import { api } from '../../api/client'
import type { Competition, FootballTeam } from '../../types'

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

  async function handleImport() {
    if (!groupName || teams.length === 0) return
    setImporting(true)
    setError('')
    try {
      const res = await api.post<{ groupId: number; teamCount: number }>('/fixtures/import', {
        groupName,
        teamNames: teams.map(t => t.name),
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
