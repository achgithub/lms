import { useState, useEffect, FormEvent } from 'react'
import { api } from '../../api/client'
import type { User, Role } from '../../types'

const ROLES: Role[] = ['manager', 'games', 'reports', 'player']

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Create form
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('player')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit state
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState<Role>('player')
  const [editActive, setEditActive] = useState(true)

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null)

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    try {
      const res = await api.get<{ users: User[] }>('/admin/users')
      setUsers(res.users ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      await api.post('/admin/users', { email, name, role, password })
      setEmail(''); setName(''); setPassword(''); setRole('player')
      loadUsers()
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create user')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(u: User) {
    setEditId(u.id)
    setEditName(u.name)
    setEditRole(u.role)
    setEditActive(u.isActive)
  }

  async function handleSaveEdit(id: number) {
    try {
      await api.put(`/admin/users/${id}`, { name: editName, role: editRole, isActive: editActive })
      setEditId(null)
      loadUsers()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to update user')
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.delete(`/admin/users/${id}`)
      setDeleteId(null)
      loadUsers()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to delete user')
    }
  }

  return (
    <div data-testid="page-users">
      <div className="card">
        <h2>Create User</h2>
        <form onSubmit={handleCreate} data-testid="form-create-user">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="new-email">Email</label>
              <input id="new-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                data-testid="input-user-email" aria-label="New user email" required />
            </div>
            <div className="form-group">
              <label htmlFor="new-name">Name</label>
              <input id="new-name" type="text" value={name} onChange={e => setName(e.target.value)}
                data-testid="input-user-name" aria-label="New user name" required />
            </div>
            <div className="form-group">
              <label htmlFor="new-role">Role</label>
              <select id="new-role" value={role} onChange={e => setRole(e.target.value as Role)}
                data-testid="select-user-role" aria-label="New user role">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="new-password">Temp Password</label>
              <input id="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                data-testid="input-user-password" aria-label="Temporary password" required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating} data-testid="btn-create-user">
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </div>
          {createError && <p className="error" role="alert" data-testid="create-user-error">{createError}</p>}
        </form>
      </div>

      <div className="card">
        <h2>Users</h2>
        {loading ? <p className="empty">Loading…</p> : error ? <p className="error">{error}</p> : (
          <table aria-label="Users list">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Must Change PW</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr><td colSpan={6} className="empty">No users yet</td></tr>
              )}
              {users.map(u => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  {editId === u.id ? (
                    <>
                      <td><input value={editName} onChange={e => setEditName(e.target.value)}
                        data-testid={`input-edit-name-${u.id}`} aria-label="Edit name" /></td>
                      <td>{u.email}</td>
                      <td>
                        <select value={editRole} onChange={e => setEditRole(e.target.value as Role)}
                          data-testid={`select-edit-role-${u.id}`} aria-label="Edit role">
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td>
                        <label>
                          <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)}
                            data-testid={`checkbox-edit-active-${u.id}`} aria-label="Active" />
                          {' '}Active
                        </label>
                      </td>
                      <td>{u.mustChangePw ? 'Yes' : 'No'}</td>
                      <td style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(u.id)}
                          data-testid={`btn-save-user-${u.id}`}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}
                          data-testid={`btn-cancel-edit-${u.id}`}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{u.name}</td>
                      <td>{u.email}</td>
                      <td><span className={`badge badge-${u.role}`} data-testid={`badge-role-${u.id}`}>{u.role}</span></td>
                      <td>
                        <span className={`badge ${u.isActive ? 'badge-active' : 'badge-eliminated'}`}
                          data-testid={`badge-active-${u.id}`}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td>{u.mustChangePw ? 'Yes' : 'No'}</td>
                      <td style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(u)}
                          data-testid={`btn-edit-user-${u.id}`} aria-label={`Edit ${u.name}`}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(u.id)}
                          data-testid={`btn-delete-user-${u.id}`} aria-label={`Delete ${u.name}`}>Delete</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteId !== null && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
          <div className="modal" data-testid="modal-delete-user">
            <h2 id="delete-user-title">Delete User</h2>
            <p>Are you sure? This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}
                data-testid="btn-cancel-delete-user">Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}
                data-testid="btn-confirm-delete-user">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
