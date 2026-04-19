import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTabAccess, type Tab } from '../hooks/useTabAccess'

const TAB_LABELS: Record<Tab, string> = {
  fixtures: 'Fixtures',
  manager: 'Manager',
  games: 'Games',
  reports: 'Reports',
}

const TAB_PATHS: Record<Tab, string> = {
  fixtures: '/fixtures',
  manager: '/setup',
  games: '/games',
  reports: '/reports',
}

export default function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const tabs = useTabAccess(user!.role)

  const isAdminView = user?.role === 'admin'
  const isPlayerView = user?.role === 'player'

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header" role="banner">
        <h1>🎯 Last Man Standing</h1>
        <span className="spacer" />
        <span className="user-info" data-testid="header-user-name">{user?.name}</span>
        <button
          onClick={logout}
          data-testid="btn-logout"
          aria-label="Log out"
        >
          Log out
        </button>
      </header>

      {isAdminView && (
        <nav className="tab-nav" role="tablist" aria-label="Admin navigation" data-testid="admin-nav">
          <button
            role="tab"
            aria-selected={location.pathname.startsWith('/admin')}
            data-testid="tab-users"
            onClick={() => navigate('/admin/users')}
          >
            Users
          </button>
        </nav>
      )}

      {isPlayerView && (
        <nav className="tab-nav" role="tablist" aria-label="Player navigation" data-testid="player-nav">
          <button
            role="tab"
            aria-selected={location.pathname.startsWith('/my-games')}
            data-testid="tab-my-games"
            onClick={() => navigate('/my-games')}
          >
            My Games
          </button>
        </nav>
      )}

      {!isAdminView && !isPlayerView && tabs.length > 0 && (
        <nav className="tab-nav" role="tablist" aria-label="Main navigation" data-testid="main-nav">
          {tabs.map(tab => {
            const path = TAB_PATHS[tab]
            const active = location.pathname.startsWith(path) ||
              (tab === 'games' && location.pathname.startsWith('/games'))
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={active}
                data-testid={`tab-${tab}`}
                onClick={() => navigate(path)}
              >
                {TAB_LABELS[tab]}
              </button>
            )
          })}
        </nav>
      )}

      <main className="page-content" data-testid="page-content">
        <Outlet />
      </main>
    </div>
  )
}
