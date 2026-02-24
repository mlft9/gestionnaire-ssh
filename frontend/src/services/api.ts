import axios from 'axios'
import { useAuthStore } from '../store/auth'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,  // Envoie les cookies httpOnly
  headers: { 'Content-Type': 'application/json' },
})

// Intercepteur : ajoute le token Bearer si disponible
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Intercepteur : rafraîchit le token si 401
let isRefreshing = false
let queue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true

      if (isRefreshing) {
        return new Promise((resolve) => {
          queue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`
            resolve(api(original))
          })
        })
      }

      isRefreshing = true
      try {
        const res = await api.post('/auth/refresh')
        const token = res.data.access_token
        useAuthStore.getState().setAccessToken(token)
        queue.forEach((cb) => cb(token))
        queue = []
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      } catch {
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }
    return Promise.reject(error)
  }
)

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface RegisterResponse {
  id: string
  email: string
  kdf_salt: string
  kdf_params: { m: number; t: number; p: number }
}

export interface LoginResponse {
  // Full user (normal login or after 2FA verify)
  user?: {
    id?: string
    email?: string
    kdf_salt: string
    kdf_params: { m: number; t: number; p: number }
    is_admin?: boolean
    totp_enabled?: boolean
  }
  access_token?: string
  // 2FA required
  two_factor_required?: boolean
  totp_setup_required?: boolean
  totp_token?: string
}

export const authApi = {
  register: (email: string, password: string) =>
    api.post<RegisterResponse>('/auth/register', { email, password }),

  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get<RegisterResponse>('/auth/me'),
}

// ─── TOTP / 2FA ───────────────────────────────────────────────────────────────

export const totpApi = {
  // authToken: totp_pending JWT (login flow) or undefined (dashboard flow, uses store token)
  setup: (authToken?: string) =>
    api.get<{ secret: string; otpauth_url: string }>('/auth/2fa/setup', {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }),

  enable: (code: string, authToken?: string) =>
    api.post<{ message: string }>('/auth/2fa/enable', { code }, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }),

  disable: (code: string) =>
    api.post<{ message: string }>('/auth/2fa/disable', { code }),

  verify: (totpToken: string, code: string) =>
    api.post<LoginResponse>('/auth/2fa/verify', { totp_token: totpToken, code }),
}

// ─── Hosts ────────────────────────────────────────────────────────────────────

export interface Host {
  id: string
  user_id: string
  name: string
  hostname: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  encrypted_cred: string  // base64
  iv: string              // base64
  tags: string[]
  icon: string
  created_at: string
  updated_at: string
}

export interface CreateHostPayload {
  name: string
  hostname: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  encrypted_cred: string  // base64
  iv: string              // base64
  tags: string[]
  icon: string
}

export const hostsApi = {
  list: () => api.get<Host[]>('/hosts'),
  get: (id: string) => api.get<Host>(`/hosts/${id}`),
  create: (data: CreateHostPayload) => api.post<Host>('/hosts', data),
  update: (id: string, data: CreateHostPayload) => api.put<Host>(`/hosts/${id}`, data),
  delete: (id: string) => api.delete(`/hosts/${id}`),
}

// ─── Credentials vault ────────────────────────────────────────────────────────

export interface Credential {
  id: string
  user_id: string
  name: string
  type: 'key' | 'password'
  encrypted_cred: string  // base64
  iv: string              // base64
  created_at: string
}

export const credentialsApi = {
  list: () => api.get<Credential[]>('/credentials'),
  create: (data: { name: string; type: 'key' | 'password'; encrypted_cred: string; iv: string }) =>
    api.post<Credential>('/credentials', data),
  delete: (id: string) => api.delete(`/credentials/${id}`),
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export const settingsApi = {
  getRegistration: () =>
    api.get<{ allow_registration: boolean }>('/settings/registration'),
  setRegistration: (allow: boolean) =>
    api.put<{ allow_registration: boolean }>('/settings/registration', { allow_registration: allow }),
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export const profileApi = {
  updateEmail: (newEmail: string, currentPassword: string) =>
    api.put<{ message: string; new_email: string }>('/auth/profile', {
      action: 'email',
      new_email: newEmail,
      current_password: currentPassword,
    }),

  updatePassword: (currentPassword: string, newPassword: string) =>
    api.put<{ message: string }>('/auth/profile', {
      action: 'password',
      current_password: currentPassword,
      new_password: newPassword,
    }),
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string
  email: string
  is_admin: boolean
  totp_enabled: boolean
  created_at: string
}

export interface AdminSession {
  id: string
  user_email: string
  host_name: string
  host_hostname: string
  started_at: string
  ended_at: string | null
  client_ip: string
}

export const adminApi = {
  listUsers:    ()        => api.get<AdminUser[]>('/admin/users'),
  deleteUser:   (id: string) => api.delete(`/admin/users/${id}`),
  listSessions: ()        => api.get<AdminSession[]>('/admin/sessions'),
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export const initApi = {
  status: () =>
    api.get<{ initialized: boolean }>('/init/status'),
  init: (email: string, password: string) =>
    api.post<{ message: string }>('/init', { email, password }),
}
