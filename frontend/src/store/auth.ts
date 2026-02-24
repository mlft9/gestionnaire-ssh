/**
 * Store Zustand pour l'authentification.
 *
 * La MasterKey (CryptoKey) est stockée uniquement en mémoire.
 * Elle est dérivée au login et effacée au logout.
 * Elle ne touche JAMAIS localStorage/sessionStorage.
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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  masterKey: null,
  accessToken: null,
  isLoading: false,
  error: null,

  setUser: (user, masterKey, accessToken) =>
    set({ user, masterKey, accessToken, error: null }),

  setAccessToken: (token) => set({ accessToken: token }),

  setEmail: (email) =>
    set((state) => ({
      user: state.user ? { ...state.user, email } : null,
    })),

  setTOTPEnabled: (enabled) =>
    set((state) => ({
      user: state.user ? { ...state.user, totpEnabled: enabled } : null,
    })),

  logout: () => set({ user: null, masterKey: null, accessToken: null }),

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
