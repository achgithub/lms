import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../api/client'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{ token: string; user: { id: number; email: string; name: string; role: string; mustChangePw: boolean } }>(
        '/auth/login', { email, password }
      )
      login(res.token, {
        id: res.user.id,
        email: res.user.email,
        name: res.user.name,
        role: res.user.role as never,
        mustChangePw: res.user.mustChangePw,
      })
      if (res.user.mustChangePw) {
        navigate('/change-password', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" data-testid="page-login">
      <div className="auth-card">
        <h1>Last Man Standing</h1>
        <p>Sign in to continue</p>
        <form onSubmit={handleSubmit} data-testid="form-login">
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              data-testid="input-email"
              aria-label="Email address"
              required
              autoFocus
            />
          </div>
          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              data-testid="input-password"
              aria-label="Password"
              required
            />
          </div>
          {error && <p className="error" role="alert" data-testid="login-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
            data-testid="btn-login"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
