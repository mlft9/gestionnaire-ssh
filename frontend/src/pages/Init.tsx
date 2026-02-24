import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, Loader2, ShieldAlert } from 'lucide-react'
import { initApi } from '../services/api'

export default function InitPage({ onInitialized }: { onInitialized: () => void }) {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères')
      return
    }

    setLoading(true)
    try {
      await initApi.init(email, password)
      onInitialized()
      navigate('/login')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Erreur lors de la création du compte')
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
          <div className="flex items-start gap-2 mb-5 p-3 bg-warning/10 border border-warning/20 rounded-md">
            <ShieldAlert className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <p className="text-xs text-gray-400">
              <strong className="text-gray-300">Premier démarrage.</strong>{' '}
              Créez le compte administrateur pour initialiser l'application.
            </p>
          </div>

          <h2 className="text-lg font-medium text-gray-100 mb-5">Créer le compte admin</h2>

          {error && (
            <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                className="input"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Mot de passe</label>
              <input
                type="password"
                className="input"
                placeholder="Min. 8 caractères"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Confirmer</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
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
                  Initialisation…
                </>
              ) : (
                'Initialiser l\'application'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
