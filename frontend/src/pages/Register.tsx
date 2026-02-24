import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Terminal, Loader2, ShieldCheck, Lock } from 'lucide-react'
import { authApi, settingsApi } from '../services/api'

export default function RegisterPage() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registrationAllowed, setRegistrationAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    settingsApi.getRegistration()
      .then(({ data }) => setRegistrationAllowed(data.allow_registration))
      .catch(() => setRegistrationAllowed(true)) // Failsafe : autorisé par défaut
  }, [])

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
      await authApi.register(email, password)
      navigate('/login')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Erreur lors de la création du compte')
    } finally {
      setLoading(false)
    }
  }

  // Chargement de la configuration
  if (registrationAllowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    )
  }

  // Inscriptions désactivées
  if (!registrationAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-900 px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-2 bg-accent-500 rounded-lg">
              <Terminal className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-gray-100">SSH Manager</h1>
          </div>
          <div className="card p-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-surface-700 rounded-full">
                <Lock className="w-6 h-6 text-gray-400" />
              </div>
            </div>
            <h2 className="text-lg font-medium text-gray-100 mb-2">Inscriptions désactivées</h2>
            <p className="text-sm text-gray-400 mb-5">
              Les inscriptions sont actuellement fermées.
              Contactez votre administrateur pour obtenir un accès.
            </p>
            <Link to="/login" className="btn-primary w-full justify-center inline-flex items-center">
              Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    )
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
          <h2 className="text-lg font-medium text-gray-100 mb-2">Créer un compte</h2>

          {/* Notice E2EE */}
          <div className="flex items-start gap-2 mb-5 p-3 bg-success/10 border border-success/20 rounded-md">
            <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
            <p className="text-xs text-gray-400">
              Vos credentials SSH seront chiffrés avec votre mot de passe.
              <strong className="text-gray-300"> Seul vous pouvez les déchiffrer.</strong>
            </p>
          </div>

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
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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

            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Création…
                </>
              ) : (
                'Créer le compte'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          Déjà un compte ?{' '}
          <Link to="/login" className="text-accent-400 hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  )
}
