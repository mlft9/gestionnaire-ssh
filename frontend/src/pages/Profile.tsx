import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Loader2, Eye, EyeOff, ShieldCheck, ShieldOff,
  Terminal, Lock, Mail, KeyRound, AlertTriangle, ShieldCheck as Shield,
  User, Settings, LogOut, Vault, Plus, Trash2, Key, Server,
} from 'lucide-react'
import { toDataURL as qrToDataURL } from 'qrcode'
import { totpApi, profileApi, authApi, credentialsApi, Credential } from '../services/api'
import { useAuthStore } from '../store/auth'
import { encryptCredential } from '../crypto'

type Tab = 'account' | 'security' | 'vault'
type Section = null | 'email' | 'password' | 'totp_setup' | 'totp_disable'

export default function ProfilePage() {
  const navigate = useNavigate()
  const { user, masterKey, setEmail, setTOTPEnabled, logout } = useAuthStore()

  async function handleLogout() {
    await authApi.logout()
    logout()
    navigate('/login')
  }

  const [tab, setTab] = useState<Tab>('account')
  const [section, setSection] = useState<Section>(null)

  // Email change
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')

  // Password change
  const [curPassword, setCurPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // TOTP setup
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [qrSecret, setQrSecret] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [totpCode, setTotpCode] = useState('')

  // Vault
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [vaultLoading, setVaultLoading] = useState(false)
  const [showVaultForm, setShowVaultForm] = useState(false)
  const [vaultName, setVaultName] = useState('')
  const [vaultType, setVaultType] = useState<'key' | 'password'>('key')
  const [vaultCred, setVaultCred] = useState('')
  const [showVaultCred, setShowVaultCred] = useState(false)
  const [vaultError, setVaultError] = useState('')

  // UI
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Generate QR code from otpauth URL
  useEffect(() => {
    if (otpauthUrl) {
      qrToDataURL(otpauthUrl, { width: 200, margin: 2 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''))
    }
  }, [otpauthUrl])

  // Load credentials when vault tab is opened
  useEffect(() => {
    if (tab === 'vault') {
      setVaultLoading(true)
      credentialsApi.list()
        .then(({ data }) => setCredentials(data))
        .catch(() => {})
        .finally(() => setVaultLoading(false))
    }
  }, [tab])

  function openSection(s: Section) {
    setSection(s)
    setError('')
    setSuccess('')
    setNewEmail('')
    setEmailPassword('')
    setCurPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setTotpCode('')
    setQrDataUrl('')
    setOtpauthUrl('')
    setQrSecret('')
    setShowSecret(false)
  }

  // Fetch QR code when opening totp_setup
  useEffect(() => {
    if (section === 'totp_setup') {
      setLoading(true)
      totpApi.setup()
        .then(({ data }) => {
          setOtpauthUrl(data.otpauth_url)
          setQrSecret(data.secret)
        })
        .catch((err) => {
          const msg = (err as { response?: { data?: { error?: string } } })
            ?.response?.data?.error
          setError(msg ?? 'Erreur lors de la génération du QR code')
          setSection(null)
        })
        .finally(() => setLoading(false))
    }
  }, [section])

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await profileApi.updateEmail(newEmail, emailPassword)
      setEmail(data.new_email)
      setSuccess('Email mis à jour avec succès.')
      setSection(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Erreur lors de la mise à jour')
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    setError('')
    setLoading(true)
    try {
      await profileApi.updatePassword(curPassword, newPassword)
      logout()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Erreur lors du changement de mot de passe')
      setLoading(false)
    }
  }

  async function handleTOTPEnable(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await totpApi.enable(totpCode)
      setTOTPEnabled(true)
      setSuccess('La double authentification est maintenant activée.')
      setSection(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Code invalide — vérifiez votre application')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleTOTPDisable(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await totpApi.disable(totpCode)
      setTOTPEnabled(false)
      setSuccess('La double authentification a été désactivée.')
      setSection(null)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Code invalide')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleVaultCreate(e: React.FormEvent) {
    e.preventDefault()
    setVaultError('')
    if (!masterKey) {
      setVaultError('Clé de chiffrement manquante — reconnectez-vous')
      return
    }
    if (!vaultCred.trim()) {
      setVaultError('Le credential est requis')
      return
    }
    setVaultLoading(true)
    try {
      const blob = await encryptCredential(masterKey, vaultCred)
      const { data } = await credentialsApi.create({
        name: vaultName,
        type: vaultType,
        encrypted_cred: blob.encryptedCred,
        iv: blob.iv,
      })
      setCredentials((prev) => [data, ...prev])
      setShowVaultForm(false)
      setVaultName('')
      setVaultCred('')
      setVaultType('key')
      setShowVaultCred(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setVaultError(msg ?? 'Erreur lors de la sauvegarde')
    } finally {
      setVaultLoading(false)
    }
  }

  async function handleVaultDelete(id: string) {
    try {
      await credentialsApi.delete(id)
      setCredentials((prev) => prev.filter((c) => c.id !== id))
    } catch {
      // ignore
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
              <Shield className="w-3.5 h-3.5" />
              <span>E2EE activé</span>
            </div>
            <Link to="/" className="btn-ghost py-1.5 px-3 text-xs" title="Retour aux hôtes">
              <Server className="w-3.5 h-3.5" />
              Hôtes
            </Link>
            <Link to="/profil" className="btn-ghost py-1.5 px-3 text-xs text-accent-400" title="Mon profil">
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

      {/* Content */}
      <main className="max-w-lg mx-auto px-6 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Shield className="w-5 h-5 text-accent-400" />
          <h1 className="text-lg font-semibold text-gray-100">Mon profil</h1>
        </div>

        <div className="card flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-surface-700 shrink-0">
            {(['account', 'security', 'vault'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); openSection(null) }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  tab === t
                    ? 'text-accent-400 border-b-2 border-accent-400'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'account' ? 'Compte' : t === 'security' ? 'Sécurité' : 'Coffre-fort'}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="p-5 space-y-4">
            {success && (
              <div className="px-3 py-2 bg-success/10 border border-success/30 rounded-md text-sm text-success">
                {success}
              </div>
            )}

            {/* ── Account tab ─────────────────────────────────────────────────── */}
            {tab === 'account' && (
              <>
                {/* Email section */}
                <div className="bg-surface-700 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400">Email</p>
                        <p className="text-sm text-gray-200 truncate">{user?.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => openSection(section === 'email' ? null : 'email')}
                      className="btn-ghost py-1 px-2.5 text-xs shrink-0 ml-2"
                    >
                      {section === 'email' ? 'Annuler' : 'Modifier'}
                    </button>
                  </div>

                  {section === 'email' && (
                    <form onSubmit={handleEmailSubmit} className="border-t border-surface-600 px-4 py-3 space-y-3">
                      {error && <p className="text-xs text-danger">{error}</p>}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Nouvel email</label>
                        <input
                          type="email"
                          className="input"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Mot de passe actuel</label>
                        <input
                          type="password"
                          className="input"
                          value={emailPassword}
                          onChange={(e) => setEmailPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                        />
                      </div>
                      <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Mise à jour…</> : 'Enregistrer'}
                      </button>
                    </form>
                  )}
                </div>

                {/* Password section */}
                <div className="bg-surface-700 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400">Mot de passe</p>
                        <p className="text-sm text-gray-200">••••••••</p>
                      </div>
                    </div>
                    <button
                      onClick={() => openSection(section === 'password' ? null : 'password')}
                      className="btn-ghost py-1 px-2.5 text-xs shrink-0 ml-2"
                    >
                      {section === 'password' ? 'Annuler' : 'Changer'}
                    </button>
                  </div>

                  {section === 'password' && (
                    <form onSubmit={handlePasswordSubmit} className="border-t border-surface-600 px-4 py-3 space-y-3">
                      <div className="flex items-start gap-2 p-2 bg-warning/10 border border-warning/20 rounded-md">
                        <AlertTriangle className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                        <p className="text-xs text-gray-400">
                          Changer le mot de passe <strong className="text-gray-300">supprimera tous vos hôtes et credentials</strong> enregistrés
                          et vous déconnectera. Les données chiffrées ne peuvent pas être re-chiffrées.
                        </p>
                      </div>

                      {error && <p className="text-xs text-danger">{error}</p>}

                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Mot de passe actuel</label>
                        <input
                          type="password"
                          className="input"
                          value={curPassword}
                          onChange={(e) => setCurPassword(e.target.value)}
                          required
                          autoFocus
                          autoComplete="current-password"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Nouveau mot de passe</label>
                        <input
                          type="password"
                          className="input"
                          placeholder="Min. 8 caractères"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Confirmer</label>
                        <input
                          type="password"
                          className="input"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                        />
                      </div>
                      <button type="submit" className="btn-danger w-full justify-center" disabled={loading}>
                        {loading
                          ? <><Loader2 className="w-4 h-4 animate-spin" />Changement…</>
                          : 'Changer et se déconnecter'}
                      </button>
                    </form>
                  )}
                </div>

                {tab === 'account' && !section && (
                  <div className="flex items-center gap-2 px-1">
                    <Lock className="w-3.5 h-3.5 text-gray-600" />
                    <p className="text-xs text-gray-600">Les modifications de compte requièrent votre mot de passe actuel.</p>
                  </div>
                )}
              </>
            )}

            {/* ── Security tab ─────────────────────────────────────────────────── */}
            {tab === 'security' && (
              <div className="bg-surface-700 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    {user?.totpEnabled
                      ? <ShieldCheck className="w-4 h-4 text-success shrink-0" />
                      : <ShieldOff className="w-4 h-4 text-gray-500 shrink-0" />
                    }
                    <div>
                      <p className="text-xs text-gray-400">Double authentification (2FA)</p>
                      <p className={`text-sm font-medium ${user?.totpEnabled ? 'text-success' : 'text-gray-400'}`}>
                        {user?.totpEnabled ? 'Activée' : 'Désactivée'}
                      </p>
                    </div>
                  </div>
                  {!user?.totpEnabled ? (
                    <button
                      onClick={() => openSection(section === 'totp_setup' ? null : 'totp_setup')}
                      className="btn-ghost py-1 px-2.5 text-xs shrink-0 ml-2"
                    >
                      {section === 'totp_setup' ? 'Annuler' : 'Configurer'}
                    </button>
                  ) : (
                    <button
                      onClick={() => openSection(section === 'totp_disable' ? null : 'totp_disable')}
                      className="btn-ghost py-1 px-2.5 text-xs text-danger hover:text-danger shrink-0 ml-2"
                    >
                      {section === 'totp_disable' ? 'Annuler' : 'Désactiver'}
                    </button>
                  )}
                </div>

                {/* Setup flow */}
                {section === 'totp_setup' && (
                  <div className="border-t border-surface-600 px-4 py-3 space-y-3">
                    {error && <p className="text-xs text-danger">{error}</p>}
                    <p className="text-xs text-gray-400">
                      Scannez ce QR code avec Google Authenticator, Authy ou toute application TOTP.
                    </p>

                    <div className="flex justify-center">
                      {loading || !qrDataUrl ? (
                        <div className="w-40 h-40 flex items-center justify-center bg-surface-600 rounded-lg">
                          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
                        </div>
                      ) : (
                        <img
                          src={qrDataUrl}
                          alt="QR code 2FA"
                          className="w-40 h-40 rounded-lg border border-surface-500"
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mx-auto transition-colors"
                    >
                      {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {showSecret ? 'Masquer la clé' : 'Saisie manuelle'}
                    </button>

                    {showSecret && (
                      <div className="p-2 bg-surface-600 rounded-md">
                        <p className="text-xs text-gray-400 mb-1">Clé secrète</p>
                        <code className="text-xs text-gray-200 font-mono break-all select-all">{qrSecret}</code>
                      </div>
                    )}

                    <form onSubmit={handleTOTPEnable} className="space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Code de confirmation</label>
                        <input
                          type="text"
                          inputMode="numeric"
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
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Activation…</> : 'Activer la 2FA'}
                      </button>
                    </form>
                  </div>
                )}

                {/* Disable flow */}
                {section === 'totp_disable' && (
                  <form onSubmit={handleTOTPDisable} className="border-t border-surface-600 px-4 py-3 space-y-3">
                    {error && <p className="text-xs text-danger">{error}</p>}
                    <p className="text-xs text-gray-400">
                      Saisissez un code de votre application pour confirmer la désactivation.
                    </p>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Code de votre application</label>
                      <input
                        type="text"
                        inputMode="numeric"
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
                      className="btn-danger w-full justify-center"
                      disabled={loading || totpCode.length !== 6}
                    >
                      {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Désactivation…</> : 'Désactiver la 2FA'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* ── Vault tab ────────────────────────────────────────────────────── */}
            {tab === 'vault' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Credentials chiffrés E2EE, réutilisables lors de la création d'hôtes.
                  </p>
                  <button
                    onClick={() => { setShowVaultForm((v) => !v); setVaultError('') }}
                    className="btn-ghost py-1 px-2.5 text-xs shrink-0"
                  >
                    {showVaultForm ? 'Annuler' : <><Plus className="w-3.5 h-3.5" />Ajouter</>}
                  </button>
                </div>

                {/* Add form */}
                {showVaultForm && (
                  <form onSubmit={handleVaultCreate} className="bg-surface-700 rounded-lg p-4 space-y-3">
                    {vaultError && <p className="text-xs text-danger">{vaultError}</p>}
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Nom *</label>
                      <input
                        className="input"
                        placeholder="Clé perso, Clé pro…"
                        value={vaultName}
                        onChange={(e) => setVaultName(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-2">Type</label>
                      <div className="flex gap-2">
                        {(['key', 'password'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setVaultType(t)}
                            className={`flex-1 py-1.5 px-3 rounded-md text-xs border transition-colors ${
                              vaultType === t
                                ? 'bg-accent-500/20 border-accent-500 text-accent-400'
                                : 'bg-surface-600 border-surface-500 text-gray-400 hover:border-surface-400'
                            }`}
                          >
                            {t === 'key' ? 'Clé privée' : 'Mot de passe'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {vaultType === 'key' ? 'Clé privée (PEM)' : 'Mot de passe'} *
                      </label>
                      <div className="relative">
                        {vaultType === 'password' ? (
                          <>
                            <input
                              type={showVaultCred ? 'text' : 'password'}
                              className="input pr-10"
                              placeholder="••••••••"
                              value={vaultCred}
                              onChange={(e) => setVaultCred(e.target.value)}
                              required
                            />
                            <button
                              type="button"
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                              onClick={() => setShowVaultCred((v) => !v)}
                            >
                              {showVaultCred ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </>
                        ) : (
                          <textarea
                            className="input font-mono text-xs resize-none h-28"
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                            value={vaultCred}
                            onChange={(e) => setVaultCred(e.target.value)}
                            required
                          />
                        )}
                      </div>
                    </div>
                    <button type="submit" className="btn-primary w-full justify-center" disabled={vaultLoading}>
                      {vaultLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Chiffrement…</>
                        : 'Enregistrer'}
                    </button>
                  </form>
                )}

                {/* List */}
                {vaultLoading && !showVaultForm ? (
                  <div className="flex items-center justify-center py-8 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    Chargement…
                  </div>
                ) : credentials.length === 0 && !showVaultForm ? (
                  <div className="flex flex-col items-center py-8 text-gray-600">
                    <Vault className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-sm">Aucun credential enregistré</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {credentials.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between px-4 py-3 bg-surface-700 rounded-lg"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-1.5 rounded-md shrink-0 ${
                            c.type === 'key'
                              ? 'bg-warning/10 text-warning'
                              : 'bg-surface-600 text-gray-400'
                          }`}>
                            <Key className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm text-gray-200 truncate">{c.name}</p>
                            <p className="text-xs text-gray-500">
                              {c.type === 'key' ? 'Clé privée' : 'Mot de passe'}
                              {' · '}
                              {new Date(c.created_at).toLocaleDateString('fr-FR')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleVaultDelete(c.id)}
                          className="btn-ghost p-1.5 hover:text-danger shrink-0 ml-2"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
