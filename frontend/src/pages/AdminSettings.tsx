import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Terminal, Users, Loader2, ShieldCheck, User, Settings,
  LogOut, Server, Trash2, Shield, History, KeyRound, Circle,
} from 'lucide-react'
import { settingsApi, authApi, adminApi, AdminUser, AdminSession } from '../services/api'
import { useAuthStore } from '../store/auth'

type Tab = 'settings' | 'users' | 'sessions'

function formatDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function AdminSettingsPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [tab, setTab] = useState<Tab>('settings')

  async function handleLogout() {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  // Redirect if not admin
  useEffect(() => {
    if (user && !user.isAdmin) navigate('/', { replace: true })
  }, [user, navigate])

  // ─── Settings tab ────────────────────────────────────────────────────────

  const [allowRegistration, setAllowRegistration] = useState(true)
  const [toggleLoading, setToggleLoading] = useState(false)

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

  // ─── Users tab ────────────────────────────────────────────────────────────

  const [users, setUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<AdminUser | undefined>()
  const [deleteError, setDeleteError] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    if (tab === 'users' && user?.isAdmin) {
      setUsersLoading(true)
      adminApi.listUsers()
        .then(({ data }) => setUsers(data))
        .catch(() => {})
        .finally(() => setUsersLoading(false))
    }
  }, [tab, user?.isAdmin])

  async function handleDeleteUser(target: AdminUser) {
    setDeleteLoading(true)
    setDeleteError('')
    try {
      await adminApi.deleteUser(target.id)
      setUsers((prev) => prev.filter((u) => u.id !== target.id))
      setDeleteConfirm(undefined)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setDeleteError(msg ?? 'Erreur lors de la suppression')
    } finally {
      setDeleteLoading(false)
    }
  }

  // ─── Sessions tab ─────────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('')

  useEffect(() => {
    if (tab === 'sessions' && user?.isAdmin) {
      setSessionsLoading(true)
      adminApi.listSessions()
        .then(({ data }) => setSessions(data ?? []))
        .catch(() => {})
        .finally(() => setSessionsLoading(false))
    }
  }, [tab, user?.isAdmin])

  const filteredSessions = sessionFilter.trim()
    ? sessions.filter((s) =>
        s.user_email.includes(sessionFilter) ||
        s.host_name.includes(sessionFilter) ||
        s.host_hostname.includes(sessionFilter)
      )
    : sessions

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
            <Link to="/setting" className="btn-ghost py-1.5 px-3 text-xs text-accent-400">
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
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Users className="w-5 h-5 text-accent-400" />
          <h1 className="text-lg font-semibold text-gray-100">Paramètres administrateur</h1>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 mb-6">
          {(['settings', 'users', 'sessions'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-accent-400 border-b-2 border-accent-500'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'settings' && <Settings className="w-3.5 h-3.5" />}
              {t === 'users' && <Users className="w-3.5 h-3.5" />}
              {t === 'sessions' && <History className="w-3.5 h-3.5" />}
              {t === 'settings' ? 'Paramètres' : t === 'users' ? 'Utilisateurs' : 'Sessions'}
            </button>
          ))}
        </div>

        {/* ── Onglet Paramètres ── */}
        {tab === 'settings' && (
          <div className="card p-5 space-y-4">
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
        )}

        {/* ── Onglet Utilisateurs ── */}
        {tab === 'users' && (
          <div className="card overflow-hidden">
            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              </div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">Aucun utilisateur</div>
            ) : (
              <ul className="divide-y divide-surface-700">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                    {/* Avatar initiale */}
                    <div className="w-8 h-8 rounded-full bg-surface-700 flex items-center justify-center shrink-0">
                      <span className="text-xs font-medium text-gray-300">
                        {u.email[0].toUpperCase()}
                      </span>
                    </div>

                    {/* Email + badges */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-100 truncate">{u.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {u.is_admin && (
                          <span className="flex items-center gap-1 text-xs text-warning">
                            <Shield className="w-3 h-3" />
                            Admin
                          </span>
                        )}
                        {u.totp_enabled && (
                          <span className="flex items-center gap-1 text-xs text-success">
                            <KeyRound className="w-3 h-3" />
                            2FA
                          </span>
                        )}
                        <span className="text-xs text-gray-600">
                          {new Date(u.created_at).toLocaleDateString('fr-FR')}
                        </span>
                      </div>
                    </div>

                    {/* Supprimer */}
                    {u.id === user?.id ? (
                      <span className="text-xs text-gray-600 px-2">Vous</span>
                    ) : (
                      <button
                        onClick={() => { setDeleteConfirm(u); setDeleteError('') }}
                        className="btn-ghost p-1.5 hover:text-danger"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Onglet Sessions ── */}
        {tab === 'sessions' && (
          <div className="space-y-4">
            <input
              type="text"
              className="input"
              placeholder="Filtrer par utilisateur, hôte…"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
            />

            <div className="card overflow-hidden">
              {sessionsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">Aucune session</div>
              ) : (
                <ul className="divide-y divide-surface-700">
                  {filteredSessions.map((s) => (
                    <li key={s.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-100 truncate">
                            <span className="text-accent-400">{s.user_email}</span>
                            <span className="text-gray-600 mx-1.5">→</span>
                            <span>{s.host_name}</span>
                            {s.host_hostname && (
                              <span className="text-gray-500 ml-1 text-xs">({s.host_hostname})</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {new Date(s.started_at).toLocaleString('fr-FR')}
                            <span className="mx-1.5">·</span>
                            {formatDuration(s.started_at, s.ended_at)}
                            <span className="mx-1.5">·</span>
                            {s.client_ip}
                          </p>
                        </div>
                        {s.ended_at === null ? (
                          <span className="flex items-center gap-1 text-xs text-success shrink-0">
                            <Circle className="w-2 h-2 fill-success" />
                            En cours
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600 shrink-0">Terminée</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal suppression utilisateur */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm">
            <h3 className="font-medium text-gray-100 mb-2">Supprimer l'utilisateur</h3>
            <p className="text-sm text-gray-400 mb-1">
              Supprimer <strong className="text-gray-300">{deleteConfirm.email}</strong> ?
            </p>
            <p className="text-xs text-gray-600 mb-5">
              Ses hôtes et credentials seront également supprimés.
            </p>
            {deleteError && (
              <p className="text-sm text-danger mb-4">{deleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setDeleteConfirm(undefined); setDeleteError('') }}
                className="btn-ghost flex-1"
                disabled={deleteLoading}
              >
                Annuler
              </button>
              <button
                onClick={() => handleDeleteUser(deleteConfirm)}
                className="btn-danger flex-1"
                disabled={deleteLoading}
              >
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
