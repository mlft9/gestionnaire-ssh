/**
 * Formulaire d'ajout/édition d'un hôte SSH.
 * Le credential peut être saisi manuellement (chiffré AES-256-GCM) ou
 * sélectionné depuis le coffre-fort (réutilisation directe des bytes chiffrés).
 */

import { useState, useEffect } from 'react'
import { Loader2, X, Eye, EyeOff, Tag, Vault, KeyRound } from 'lucide-react'
import { encryptCredential } from '../../crypto'
import { hostsApi, credentialsApi, CreateHostPayload, Host, Credential } from '../../services/api'
import { useAuthStore } from '../../store/auth'

type CredSource = 'manual' | 'vault'

interface Props {
  host?: Host
  onSuccess: (host: Host) => void
  onClose: () => void
}

export default function HostForm({ host, onSuccess, onClose }: Props) {
  const masterKey = useAuthStore((s) => s.masterKey)

  const [name, setName] = useState(host?.name ?? '')
  const [hostname, setHostname] = useState(host?.hostname ?? '')
  const [port, setPort] = useState(host?.port ?? 22)
  const [username, setUsername] = useState(host?.username ?? '')
  const [authType, setAuthType] = useState<'password' | 'key'>(host?.auth_type ?? 'password')
  const [credential, setCredential] = useState('')
  const [showCred, setShowCred] = useState(false)
  const [icon, setIcon] = useState(host?.icon ?? '')
  const [tags, setTags] = useState<string[]>(host?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Coffre-fort
  const [credSource, setCredSource] = useState<CredSource>('manual')
  const [vaultCreds, setVaultCreds] = useState<Credential[]>([])
  const [vaultLoading, setVaultLoading] = useState(false)
  const [selectedCred, setSelectedCred] = useState<Credential | null>(null)

  useEffect(() => {
    if (credSource !== 'vault') return
    setVaultLoading(true)
    credentialsApi.list()
      .then((r) => setVaultCreds(r.data))
      .catch(() => setVaultCreds([]))
      .finally(() => setVaultLoading(false))
  }, [credSource])

  // Sync authType with selected vault credential
  useEffect(() => {
    if (selectedCred) setAuthType(selectedCred.type)
  }, [selectedCred])

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim().toLowerCase()
      if (!tags.includes(newTag)) {
        setTags((prev) => [...prev, newTag])
      }
      setTagInput('')
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!masterKey) {
      setError('Clé de chiffrement manquante — reconnectez-vous')
      return
    }

    if (credSource === 'vault' && !selectedCred) {
      setError('Sélectionnez un credential depuis le coffre')
      return
    }

    if (credSource === 'manual' && !host && !credential) {
      setError('Le credential est requis')
      return
    }

    setLoading(true)
    try {
      let payload: CreateHostPayload

      if (credSource === 'vault' && selectedCred) {
        // Réutilisation directe des bytes chiffrés du coffre (même clé maître)
        payload = {
          name, hostname, port, username,
          auth_type: selectedCred.type,
          encrypted_cred: selectedCred.encrypted_cred,
          iv: selectedCred.iv,
          tags,
          icon,
        }
      } else if (credential) {
        const blob = await encryptCredential(masterKey, credential)
        payload = {
          name, hostname, port, username,
          auth_type: authType,
          encrypted_cred: blob.encryptedCred,
          iv: blob.iv,
          tags,
          icon,
        }
      } else {
        // Édition sans changer le credential
        payload = {
          name, hostname, port, username,
          auth_type: authType,
          encrypted_cred: host!.encrypted_cred,
          iv: host!.iv,
          tags,
          icon,
        }
      }

      const { data } = host
        ? await hostsApi.update(host.id, payload)
        : await hostsApi.create(payload)

      onSuccess(data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error
      setError(msg ?? 'Erreur lors de la sauvegarde')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-surface-600 shrink-0">
          <h2 className="font-medium text-gray-100">
            {host ? 'Modifier l\'hôte' : 'Nouvel hôte SSH'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="px-3 py-2 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Nom + icône emoji */}
            <div className="col-span-2 flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1.5">Nom affiché *</label>
                <input
                  className="input"
                  placeholder="Mon serveur prod"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="w-20">
                <label className="block text-xs text-gray-400 mb-1.5">Icône</label>
                <input
                  className="input text-center text-xl"
                  placeholder="🖥️"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  maxLength={2}
                  title="Un emoji pour identifier l'hôte"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Hostname / IP *</label>
              <input
                className="input"
                placeholder="192.168.1.1"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Port</label>
              <input
                type="number"
                className="input"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                min={1}
                max={65535}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1.5">Utilisateur SSH *</label>
              <input
                className="input"
                placeholder="root"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              <Tag className="w-3 h-3 inline mr-1" />
              Tags
            </label>
            <div
              className="input flex flex-wrap gap-1.5 min-h-[38px] items-center cursor-text"
              onClick={() => document.getElementById('tag-input')?.focus()}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-accent-500/15 text-accent-400 border border-accent-500/25 rounded text-xs"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-danger leading-none"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="tag-input"
                type="text"
                className="bg-transparent outline-none text-sm text-gray-200 flex-1 min-w-[80px]"
                placeholder={tags.length === 0 ? 'prod, staging… (Entrée pour valider)' : ''}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
              />
            </div>
          </div>

          {/* Source du credential */}
          <div>
            <label className="block text-xs text-gray-400 mb-2">Source du credential</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setCredSource('manual'); setSelectedCred(null) }}
                className={`flex-1 py-2 px-3 rounded-md text-sm border transition-colors flex items-center justify-center gap-2 ${
                  credSource === 'manual'
                    ? 'bg-accent-500/20 border-accent-500 text-accent-400'
                    : 'bg-surface-700 border-surface-600 text-gray-400 hover:border-surface-500'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Saisie manuelle
              </button>
              <button
                type="button"
                onClick={() => setCredSource('vault')}
                className={`flex-1 py-2 px-3 rounded-md text-sm border transition-colors flex items-center justify-center gap-2 ${
                  credSource === 'vault'
                    ? 'bg-accent-500/20 border-accent-500 text-accent-400'
                    : 'bg-surface-700 border-surface-600 text-gray-400 hover:border-surface-500'
                }`}
              >
                <Vault className="w-3.5 h-3.5" />
                Coffre-fort
              </button>
            </div>
          </div>

          {credSource === 'vault' ? (
            /* Sélecteur depuis le coffre */
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Sélectionner un credential
              </label>
              {vaultLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chargement…
                </div>
              ) : vaultCreds.length === 0 ? (
                <div className="text-sm text-gray-500 py-3 text-center bg-surface-700 rounded-md border border-surface-600">
                  Aucun credential dans le coffre.
                  <br />
                  <span className="text-xs">Ajoutez-en depuis votre profil.</span>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {vaultCreds.map((cred) => (
                    <button
                      key={cred.id}
                      type="button"
                      onClick={() => setSelectedCred(cred)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-sm transition-colors ${
                        selectedCred?.id === cred.id
                          ? 'bg-accent-500/20 border-accent-500 text-gray-100'
                          : 'bg-surface-700 border-surface-600 text-gray-300 hover:border-surface-500'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-base shrink-0">
                          {cred.type === 'key' ? '🔑' : '🔐'}
                        </span>
                        <div className="text-left min-w-0">
                          <div className="truncate font-medium">{cred.name}</div>
                          <div className="text-xs text-gray-500">
                            {cred.type === 'key' ? 'Clé privée' : 'Mot de passe'}
                          </div>
                        </div>
                      </div>
                      {selectedCred?.id === cred.id && (
                        <span className="text-accent-400 text-base shrink-0">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Saisie manuelle */
            <>
              {/* Type d'auth */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Méthode d'authentification</label>
                <div className="flex gap-3">
                  {(['password', 'key'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAuthType(type)}
                      className={`flex-1 py-2 px-3 rounded-md text-sm border transition-colors ${
                        authType === type
                          ? 'bg-accent-500/20 border-accent-500 text-accent-400'
                          : 'bg-surface-700 border-surface-600 text-gray-400 hover:border-surface-500'
                      }`}
                    >
                      {type === 'password' ? 'Mot de passe' : 'Clé privée'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Credential */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  {authType === 'password' ? 'Mot de passe SSH' : 'Clé privée (PEM)'}
                  {host && <span className="ml-1 text-gray-600">(laisser vide pour conserver)</span>}
                  {!host && <span className="text-danger ml-0.5">*</span>}
                </label>
                <div className="relative">
                  {authType === 'password' ? (
                    <>
                      <input
                        type={showCred ? 'text' : 'password'}
                        className="input pr-10"
                        placeholder="••••••••"
                        value={credential}
                        onChange={(e) => setCredential(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        onClick={() => setShowCred(!showCred)}
                      >
                        {showCred ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </>
                  ) : (
                    <textarea
                      className="input font-mono text-xs resize-none h-28"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      value={credential}
                      onChange={(e) => setCredential(e.target.value)}
                    />
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Chiffré AES-256-GCM dans votre navigateur avant envoi
                </p>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 justify-center">
              Annuler
            </button>
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chiffrement…
                </>
              ) : (
                host ? 'Mettre à jour' : 'Ajouter l\'hôte'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
