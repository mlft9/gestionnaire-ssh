import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Terminal, Users, Loader2, ShieldCheck, User, Settings, LogOut, Server } from 'lucide-react'
import { settingsApi, authApi } from '../services/api'
import { useAuthStore } from '../store/auth'

export default function AdminSettingsPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  async function handleLogout() {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  const [allowRegistration, setAllowRegistration] = useState(true)
  const [toggleLoading, setToggleLoading] = useState(false)

  // Redirect if not admin
  useEffect(() => {
    if (user && !user.isAdmin) navigate('/', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    if (user?.isAdmin) {
      settingsApi.getRegistration()
        .then(({ data }) => setAllowRegistration(data.allow_registration))
        .catch(() => {})
    }
  }, [user?.isAdmin])

  async function handleToggleRegistration() {
    setToggleLoading(true)
    try {
      const { data } = await settingsApi.setRegistration(!allowRegistration)
      setAllowRegistration(data.allow_registration)
    } catch {
      // ignore
    } finally {
      setToggleLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-surface-700 bg-surface-800 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-accent-500 rounded-md">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-gray-100">SSH Manager</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs text-success">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>E2EE activé</span>
            </div>
            <Link to="/" className="btn-ghost py-1.5 px-3 text-xs" title="Retour aux hôtes">
              <Server className="w-3.5 h-3.5" />
              Hôtes
            </Link>
            <Link to="/profil" className="btn-ghost py-1.5 px-3 text-xs" title="Mon profil">
              <User className="w-3.5 h-3.5" />
              {user?.email}
            </Link>
            <Link to="/setting" className="btn-ghost py-1.5 px-3 text-xs text-accent-400" title="Paramètres administrateur">
              <Settings className="w-3.5 h-3.5" />
              Admin
            </Link>
            <button onClick={handleLogout} className="btn-ghost py-1.5 px-3 text-xs">
              <LogOut className="w-3.5 h-3.5" />
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-lg mx-auto px-6 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Users className="w-5 h-5 text-accent-400" />
          <h1 className="text-lg font-semibold text-gray-100">Paramètres administrateur</h1>
        </div>

        <div className="card p-5 space-y-4">
          {/* Registration toggle */}
          <div className="flex items-center justify-between p-3 bg-surface-700 rounded-lg">
            <div>
              <p className="text-sm text-gray-200">Inscriptions publiques</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Autoriser la création de nouveaux comptes
              </p>
            </div>
            {toggleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
            ) : (
              <button
                onClick={handleToggleRegistration}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                  allowRegistration ? 'bg-accent-500' : 'bg-surface-600'
                } cursor-pointer`}
                role="switch"
                aria-checked={allowRegistration}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    allowRegistration ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
