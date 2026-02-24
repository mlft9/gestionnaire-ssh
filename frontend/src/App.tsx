import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, Terminal } from 'lucide-react'
import { useAuthStore, AuthUser, loadSessionUser, deriveKeyFromLogin } from './store/auth'
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

// ─── Écran de déverrouillage (refresh de page) ────────────────────────────────

function UnlockScreen({
  user,
  onUnlocked,
  onSwitchAccount,
}: {
  user: AuthUser
  onUnlocked: () => void
  onSwitchAccount: () => void
}) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const setUser = useAuthStore((s) => s.setUser)
  const accessToken = useAuthStore((s) => s.accessToken)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const masterKey = await deriveKeyFromLogin(password, user.kdfSalt, user.kdfParams)
      setUser(user, masterKey, accessToken ?? '')
      onUnlocked()
    } catch {
      setError('Mot de passe incorrect')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="p-2 bg-accent-500 rounded-lg">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-100">SSH Manager</h1>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-medium text-gray-100 mb-1">Session verrouillée</h2>
          <p className="text-xs text-gray-500 mb-6">
            Connecté en tant que{' '}
            <span className="text-gray-300">{user.email}</span>
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Mot de passe</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Déverrouillage…
                </>
              ) : (
                'Déverrouiller'
              )}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={onSwitchAccount}
          className="block text-center text-sm text-gray-500 hover:text-gray-300 mt-4 w-full transition-colors"
        >
          Se connecter avec un autre compte
        </button>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [initialized, setInitialized] = useState<boolean | null>(null)
  const [unlockUser, setUnlockUser] = useState<AuthUser | null>(null)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    async function boot() {
      // 1. Vérification first-launch
      let isInitialized = true
      try {
        const { data } = await initApi.status()
        isInitialized = data.initialized
      } catch {
        // Erreur réseau — on ne bloque pas
      }

      // 2. Tentative de restauration de session silencieuse
      if (isInitialized) {
        const savedUser = loadSessionUser()
        if (savedUser) {
          try {
            // fetch direct pour éviter l'intercepteur axios (qui gère lui-même les 401)
            const res = await fetch('/api/auth/refresh', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
            })
            if (!res.ok) throw new Error('session expired')
            const data = await res.json()
            setAccessToken(data.access_token)
            setUnlockUser(savedUser)
          } catch {
            // Session expirée — login normal
          }
        }
      }

      // 3. Affichage (après toute la logique de boot pour éviter le flash)
      setInitialized(isInitialized)
    }

    boot()
  }, [])

  if (initialized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    )
  }

  if (unlockUser) {
    return (
      <UnlockScreen
        user={unlockUser}
        onUnlocked={() => setUnlockUser(null)}
        onSwitchAccount={() => {
          logout()
          setUnlockUser(null)
        }}
      />
    )
  }

  return <AppRoutes initialized={initialized} onInitialized={() => setInitialized(true)} />
}
