import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../api/client'

export default function ForceChangePassword() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!user) {
    navigate('/login', { replace: true })
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (next.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ token: string }>('/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      })
      login(res.token, { ...user!, mustChangePw: false })
      navigate('/', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" data-testid="page-change-password">
      <div className="auth-card">
        <h1>Change Password</h1>
        <p>You must set a new password before continuing.</p>
        <form onSubmit={handleSubmit} data-testid="form-change-password">
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label htmlFor="cp-current">Current Password</label>
            <input
              id="cp-current"
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              data-testid="input-current-password"
              aria-label="Current password"
              required
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label htmlFor="cp-new">New Password</label>
            <input
              id="cp-new"
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              data-testid="input-new-password"
              aria-label="New password"
              required
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="cp-confirm">Confirm New Password</label>
            <input
              id="cp-confirm"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              data-testid="input-confirm-password"
              aria-label="Confirm new password"
              required
            />
          </div>
          {error && <p className="error" role="alert" data-testid="change-password-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
            data-testid="btn-change-password"
          >
            {loading ? 'Saving…' : 'Set New Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
