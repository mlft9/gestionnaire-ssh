import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Terminal, Loader2, ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { toDataURL as qrToDataURL } from 'qrcode'
import { authApi, totpApi, LoginResponse } from '../services/api'
import { deriveKeyFromLogin, useAuthStore } from '../store/auth'

type Step = 'credentials' | 'totp_verify' | 'totp_setup'

export default function LoginPage() {
  const navigate = useNavigate()
  const setUser = useAuthStore((s) => s.setUser)

  // Credentials (persist across steps for key derivation)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Step state
  const [step, setStep] = useState<Step>('credentials')
  const [totpCode, setTotpCode] = useState('')
  const [totpToken, setTotpToken] = useState('')

  // Setup step data
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [qrSecret, setQrSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  // UI
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Generate QR code from otpauth URL
  useEffect(() => {
    if (otpauthUrl) {
      qrToDataURL(otpauthUrl, { width: 200, margin: 2 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
    }
  }, [otpauthUrl])

  async function completeLogin(data: LoginResponse) {
    const masterKey = await deriveKeyFromLogin(
      password,
      data.user!.kdf_salt,
      data.user!.kdf_params
    )
    setUser(
      {
        id: data.user!.id!,
        email: data.user!.email!,
        kdfSalt: data.user!.kdf_salt,
        kdfParams: data.user!.kdf_params,
        isAdmin: data.user!.is_admin ?? false,
        totpEnabled: data.user!.totp_enabled ?? false,
      },
      masterKey,
      data.access_token!
    )
    navigate('/')
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // ── 1. Appel API login ─────────────────────────────────────────────────
    let loginData: LoginResponse
    try {
      const { data } = await authApi.login(email, password)
      loginData = data
    } catch (err: unknown) {
      console.error('[Login] Erreur appel API:', err)
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Serveur inaccessible — vérifiez que le backend est démarré')
      setLoading(false)
      return
    }

    // ── 2. Dérivation de clé / navigation ─────────────────────────────────
    try {
      if (loginData.two_factor_required) {
        setTotpToken(loginData.totp_token!)

        if (loginData.totp_setup_required) {
          const { data: setup } = await totpApi.setup(loginData.totp_token!)
          setOtpauthUrl(setup.otpauth_url)
          setQrSecret(setup.secret)
          setStep('totp_setup')
        } else {
          setStep('totp_verify')
        }
      } else {
        await completeLogin(loginData)
      }
    } catch (err: unknown) {
      console.error('[Login] Erreur completeLogin:', err)
      const axiosMsg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      const jsMsg = err instanceof Error ? err.message : null
      setError(axiosMsg ?? jsMsg ?? 'Erreur lors de la dérivation de clé')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const { data } = await totpApi.verify(totpToken, totpCode)
      await completeLogin(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Code invalide ou expiré')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // 1. Activate 2FA (validates the code)
      await totpApi.enable(totpCode, totpToken)
      // 2. Get real tokens (same code, no replay protection server-side)
      const { data } = await totpApi.verify(totpToken, totpCode)
      await completeLogin(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Code invalide — vérifiez votre application')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-900 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="p-2 bg-accent-500 rounded-lg">
            <Terminal className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-100">SSH Manager</h1>
        </div>

        {/* ── Step: credentials ─────────────────────────────────────────────── */}
        {step === 'credentials' && (
          <div className="card p-6">
            <h2 className="text-lg font-medium text-gray-100 mb-6">Connexion</h2>

            {error && (
              <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
                {error}
              </div>
            )}

            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Mot de passe</label>
                <input
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connexion…
                  </>
                ) : (
                  'Se connecter'
                )}
              </button>
            </form>
          </div>
        )}

        {/* ── Step: totp_verify ─────────────────────────────────────────────── */}
        {step === 'totp_verify' && (
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-accent-400" />
              <h2 className="text-lg font-medium text-gray-100">Vérification 2FA</h2>
            </div>
            <p className="text-xs text-gray-500 mb-6">
              Entrez le code à 6 chiffres de votre application d'authentification.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
                {error}
              </div>
            )}

            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Code à 6 chiffres</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input text-center text-xl tracking-widest font-mono"
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full justify-center"
                disabled={loading || totpCode.length !== 6}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Vérification…
                  </>
                ) : (
                  'Vérifier'
                )}
              </button>

              <button
                type="button"
                onClick={() => { setStep('credentials'); setError(''); setTotpCode('') }}
                className="btn-ghost w-full justify-center text-xs"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Retour à la connexion
              </button>
            </form>
          </div>
        )}

        {/* ── Step: totp_setup ──────────────────────────────────────────────── */}
        {step === 'totp_setup' && (
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-warning" />
              <h2 className="text-lg font-medium text-gray-100">Configurer la 2FA</h2>
            </div>
            <p className="text-xs text-gray-500 mb-5">
              La double authentification est obligatoire. Scannez ce QR code avec Google Authenticator,
              Authy ou toute application TOTP compatible.
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
                {error}
              </div>
            )}

            {/* QR code generated client-side */}
            <div className="flex justify-center mb-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code 2FA"
                  className="w-40 h-40 rounded-lg border border-surface-600"
                />
              ) : (
                <div className="w-40 h-40 flex items-center justify-center bg-surface-700 rounded-lg">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                </div>
              )}
            </div>

            {/* Manual entry toggle */}
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mx-auto mb-4 transition-colors"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showSecret ? 'Masquer la clé manuelle' : 'Afficher la clé pour saisie manuelle'}
            </button>

            {showSecret && (
              <div className="mb-4 p-2 bg-surface-700 rounded-md">
                <p className="text-xs text-gray-400 mb-1">Clé secrète</p>
                <code className="text-xs text-gray-200 font-mono break-all select-all">
                  {qrSecret}
                </code>
              </div>
            )}

            <form onSubmit={handleSetupSubmit} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Code de confirmation (6 chiffres)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input text-center text-xl tracking-widest font-mono"
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoComplete="one-time-code"
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full justify-center"
                disabled={loading || totpCode.length !== 6}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Activation…
                  </>
                ) : (
                  'Activer et se connecter'
                )}
              </button>
            </form>
          </div>
        )}

        {step === 'credentials' && (
          <p className="text-center text-sm text-gray-500 mt-4">
            Pas encore de compte ?{' '}
            <Link to="/register" className="text-accent-400 hover:underline">
              S'inscrire
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
