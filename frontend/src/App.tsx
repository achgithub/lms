import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import LoginPage from './components/auth/LoginPage'
import ForceChangePassword from './components/auth/ForceChangePassword'
import AppShell from './components/AppShell'
import UsersPage from './components/admin/UsersPage'
import FixturesTab from './components/fixtures/FixturesTab'
import SetupTab from './components/manager/SetupTab'
import GamesListTab from './components/manager/GamesListTab'
import GameDetailTab from './components/manager/GameDetailTab'
import MyGamesPage from './components/player/MyGamesPage'
import ReportsTab from './components/reports/ReportsTab'

function RoleHome() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePw) return <Navigate to="/change-password" replace />
  switch (user.role) {
    case 'admin': return <Navigate to="/admin/users" replace />
    case 'player': return <Navigate to="/my-games" replace />
    case 'manager': return <Navigate to="/fixtures" replace />
    case 'games': return <Navigate to="/games" replace />
    case 'reports': return <Navigate to="/reports" replace />
  }
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePw) return <Navigate to="/change-password" replace />
  return <>{children}</>
}

function RequireRole({ role, children }: { role: string | string[]; children: React.ReactNode }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePw) return <Navigate to="/change-password" replace />
  const allowed = Array.isArray(role) ? role : [role]
  if (!allowed.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user && !user.mustChangePw ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/change-password" element={<ForceChangePassword />} />

      <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<RoleHome />} />

        {/* Admin */}
        <Route path="admin/users" element={
          <RequireRole role="admin"><UsersPage /></RequireRole>
        } />

        {/* Manager tabs */}
        <Route path="fixtures" element={
          <RequireRole role="manager"><FixturesTab /></RequireRole>
        } />
        <Route path="setup" element={
          <RequireRole role="manager"><SetupTab /></RequireRole>
        } />
        <Route path="games" element={
          <RequireRole role={['manager','games']}><GamesListTab /></RequireRole>
        } />
        <Route path="games/:id" element={
          <RequireRole role={['manager','games']}><GameDetailTab /></RequireRole>
        } />

        {/* Reports */}
        <Route path="reports" element={
          <RequireRole role={['manager','games','reports']}><ReportsTab /></RequireRole>
        } />

        {/* Player */}
        <Route path="my-games" element={
          <RequireRole role="player"><MyGamesPage /></RequireRole>
        } />
        <Route path="my-games/:id" element={
          <RequireRole role="player"><MyGamesPage /></RequireRole>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
