import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from './store/auth'
import { initApi } from './services/api'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import DashboardPage from './pages/Dashboard'
import TerminalPage from './pages/Terminal'
import InitPage from './pages/Init'
import ProfilePage from './pages/Profile'
import AdminSettingsPage from './pages/AdminSettings'
import SFTPPage from './pages/SFTP'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!user.isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes({ initialized, onInitialized }: { initialized: boolean; onInitialized: () => void }) {
  const user = useAuthStore((s) => s.user)

  // Si pas initialisé, toutes les routes pointent vers /init
  if (!initialized) {
    return (
      <Routes>
        <Route path="/init" element={<InitPage onInitialized={onInitialized} />} />
        <Route path="*" element={<Navigate to="/init" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/init" element={user ? <Navigate to="/" replace /> : <Navigate to="/login" replace />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/profil"
        element={
          <PrivateRoute>
            <ProfilePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/setting"
        element={
          <AdminRoute>
            <AdminSettingsPage />
          </AdminRoute>
        }
      />
      <Route
        path="/terminal/:hostId"
        element={
          <PrivateRoute>
            <TerminalPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/sftp/:hostId"
        element={
          <PrivateRoute>
            <SFTPPage />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const [initialized, setInitialized] = useState<boolean | null>(null)

  useEffect(() => {
    initApi.status()
      .then(({ data }) => setInitialized(data.initialized))
      .catch(() => setInitialized(true)) // En cas d'erreur réseau, on ne bloque pas
  }, [])

  if (initialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    )
  }

  return <AppRoutes initialized={initialized} onInitialized={() => setInitialized(true)} />
}
