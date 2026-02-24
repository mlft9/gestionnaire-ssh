/**
 * Store Zustand pour l'authentification.
 *
 * La MasterKey (CryptoKey) est stockée uniquement en mémoire.
 * Elle est dérivée au login et effacée au logout.
 * Elle ne touche JAMAIS localStorage/sessionStorage.
 *
 * Les données utilisateur (sans MasterKey ni token) sont stockées en sessionStorage
 * pour permettre la restauration de session après un rafraîchissement de page.
 */

import { create } from 'zustand'
import { deriveMasterKey } from '../crypto'

interface KDFParams {
  m: number
  t: number
  p: number
}

export interface AuthUser {
  id: string
  email: string
  kdfSalt: string    // base64 — reçu du serveur
  kdfParams: KDFParams
  isAdmin: boolean
  totpEnabled: boolean
}

interface AuthState {
  user: AuthUser | null
  masterKey: CryptoKey | null
  accessToken: string | null
  isLoading: boolean
  error: string | null

  setUser: (user: AuthUser, masterKey: CryptoKey, accessToken: string) => void
  setAccessToken: (token: string) => void
  setEmail: (email: string) => void
  setTOTPEnabled: (enabled: boolean) => void
  logout: () => void
  clearError: () => void
}

// ─── Session storage (données user uniquement, jamais la clé ni le token) ──────

const SESSION_KEY = 'ssh_mgr_user'

function saveSession(user: AuthUser) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch { /* noop */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
}

export function loadSessionUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  masterKey: null,
  accessToken: null,
  isLoading: false,
  error: null,

  setUser: (user, masterKey, accessToken) => {
    saveSession(user)
    set({ user, masterKey, accessToken, error: null })
  },

  setAccessToken: (token) => set({ accessToken: token }),

  setEmail: (email) =>
    set((state) => {
      const user = state.user ? { ...state.user, email } : null
      if (user) saveSession(user)
      return { user }
    }),

  setTOTPEnabled: (enabled) =>
    set((state) => {
      const user = state.user ? { ...state.user, totpEnabled: enabled } : null
      if (user) saveSession(user)
      return { user }
    }),

  logout: () => {
    clearSession()
    set({ user: null, masterKey: null, accessToken: null })
  },

  clearError: () => set({ error: null }),
}))

// ─── Helpers pour l'auth ──────────────────────────────────────────────────────

export async function deriveKeyFromLogin(
  password: string,
  kdfSalt: string,
  kdfParams: KDFParams
): Promise<CryptoKey> {
  return deriveMasterKey(password, kdfSalt, kdfParams)
}
