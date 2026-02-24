import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, Terminal, LogOut, Loader2, Search, ShieldCheck, Settings, User, ArrowUpDown, Server } from 'lucide-react'
import { hostsApi, Host, authApi } from '../services/api'
import { useAuthStore } from '../store/auth'
import HostCard from '../components/Hosts/HostCard'
import HostForm from '../components/Hosts/HostForm'

type SortKey = 'recent' | 'oldest' | 'name_asc' | 'name_desc'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Plus récent',
  oldest: 'Plus ancien',
  name_asc: 'Nom A→Z',
  name_desc: 'Nom Z→A',
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editHost, setEditHost] = useState<Host | undefined>()
  const [deleteConfirm, setDeleteConfirm] = useState<Host | undefined>()

  useEffect(() => {
    hostsApi.list()
      .then(({ data }) => setHosts(data))
      .finally(() => setLoading(false))
  }, [])

  async function handleLogout() {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  function handleConnect(host: Host) {
    navigate(`/terminal/${host.id}`)
  }

  function handleSFTP(host: Host) {
    navigate(`/sftp/${host.id}`)
  }

  function handleFormSuccess(host: Host) {
    if (editHost) {
      setHosts((prev) => prev.map((h) => (h.id === host.id ? host : h)))
    } else {
      setHosts((prev) => [host, ...prev])
    }
    setShowForm(false)
    setEditHost(undefined)
  }

  async function handleDelete(host: Host) {
    await hostsApi.delete(host.id)
    setHosts((prev) => prev.filter((h) => h.id !== host.id))
    setDeleteConfirm(undefined)
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  // All unique tags across all hosts
  const allTags = useMemo(() => {
    const set = new Set<string>()
    hosts.forEach((h) => h.tags.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [hosts])

  // Filter + sort
  const filtered = useMemo(() => {
    let result = hosts.filter((h) => {
      const matchSearch =
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        h.hostname.toLowerCase().includes(search.toLowerCase())
      const matchTags =
        activeTags.length === 0 || activeTags.some((t) => h.tags.includes(t))
      return matchSearch && matchTags
    })

    result = [...result].sort((a, b) => {
      if (sort === 'name_asc') return a.name.localeCompare(b.name)
      if (sort === 'name_desc') return b.name.localeCompare(a.name)
      if (sort === 'oldest') return a.created_at.localeCompare(b.created_at)
      return b.created_at.localeCompare(a.created_at) // recent (default)
    })

    return result
  }, [hosts, search, activeTags, sort])

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
            <Link to="/" className="btn-ghost py-1.5 px-3 text-xs text-accent-400" title="Hôtes">
              <Server className="w-3.5 h-3.5" />
              Hôtes
            </Link>
            <Link to="/profil" className="btn-ghost py-1.5 px-3 text-xs" title="Mon profil">
              <User className="w-3.5 h-3.5" />
              {user?.email}
            </Link>
            {user?.isAdmin && (
              <Link to="/setting" className="btn-ghost py-1.5 px-3 text-xs" title="Paramètres administrateur">
                <Settings className="w-3.5 h-3.5" />
                Admin
              </Link>
            )}
            <button onClick={handleLogout} className="btn-ghost py-1.5 px-3 text-xs">
              <LogOut className="w-3.5 h-3.5" />
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="input pl-9"
              placeholder="Rechercher un hôte…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Sort */}
          <div className="relative">
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            <select
              className="input pl-8 pr-3 text-sm appearance-none cursor-pointer"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => { setEditHost(undefined); setShowForm(true) }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            Ajouter un hôte
          </button>
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-5">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  activeTags.includes(tag)
                    ? 'bg-accent-500/20 border-accent-500 text-accent-400'
                    : 'bg-surface-800 border-surface-600 text-gray-500 hover:border-surface-500 hover:text-gray-300'
                }`}
              >
                {tag}
              </button>
            ))}
            {activeTags.length > 0 && (
              <button
                onClick={() => setActiveTags([])}
                className="px-2.5 py-1 rounded-full text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Effacer
              </button>
            )}
          </div>
        )}

        {/* Liste */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            {hosts.length === 0 ? (
              <>
                <Terminal className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Aucun hôte configuré</p>
                <p className="text-xs mt-1">Ajoutez votre premier serveur SSH</p>
              </>
            ) : (
              <p className="text-sm">Aucun résultat</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                onConnect={handleConnect}
                onSFTP={handleSFTP}
                onEdit={(h) => { setEditHost(h); setShowForm(true) }}
                onDelete={(h) => setDeleteConfirm(h)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modal formulaire */}
      {showForm && (
        <HostForm
          host={editHost}
          onSuccess={handleFormSuccess}
          onClose={() => { setShowForm(false); setEditHost(undefined) }}
        />
      )}

      {/* Modal confirmation suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm">
            <h3 className="font-medium text-gray-100 mb-2">Supprimer l'hôte</h3>
            <p className="text-sm text-gray-400 mb-5">
              Supprimer <strong className="text-gray-300">{deleteConfirm.name}</strong> ?
              Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(undefined)} className="btn-ghost flex-1 justify-center">
                Annuler
              </button>
              <button onClick={() => handleDelete(deleteConfirm)} className="btn-danger flex-1 justify-center">
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
