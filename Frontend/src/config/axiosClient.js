import axios from 'axios'

import env from './env'
import { STORAGE_KEYS } from '../constants/app'
import { ROUTES } from '../constants/routes'
import { storage } from '../utils/storage'


// =====================================================
// Axios instance
// =====================================================

const axiosClient = axios.create({
  baseURL: env.API_BASE_URL,

  headers: {
    'Content-Type': 'application/json',
  },

  timeout: 30000,
})


// =====================================================
// Request interceptor
// =====================================================

axiosClient.interceptors.request.use(
  config => {
    const token = storage.get(
      STORAGE_KEYS.ACCESS_TOKEN,
    )

    if (token) {
      config.headers.Authorization =
        `Bearer ${token}`
    }

    return config
  },

  error => Promise.reject(error),
)


// =====================================================
// Response interceptor
// =====================================================

// Calls that must never trigger a silent refresh (they ARE the auth calls).
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh-token',
  '/auth/logout',
  '/auth/verify-otp',
  '/auth/resend-otp',
  '/auth/forgot-password',
  '/auth/reset-password',
]

function endSession() {
  storage.remove(STORAGE_KEYS.ACCESS_TOKEN)
  storage.remove(STORAGE_KEYS.REFRESH_TOKEN)
  storage.remove(STORAGE_KEYS.USER)

  const currentPath = window.location.pathname
  const isAuthenticationPage = [
    '/login',
    '/register',
    ROUTES.SESSION_EXPIRED,
  ].some(path => currentPath.startsWith(path))

  if (!isAuthenticationPage) {
    window.location.href = ROUTES.SESSION_EXPIRED
  }
}

// One refresh at a time: parallel 401s all wait for the same request.
let refreshPromise = null

function refreshSession() {
  const refreshToken = storage.get(STORAGE_KEYS.REFRESH_TOKEN)
  if (!refreshToken) return Promise.reject(new Error('no refresh token'))

  if (!refreshPromise) {
    // plain axios (no interceptors) so a failing refresh cannot loop
    refreshPromise = axios
      .post(`${env.API_BASE_URL}/auth/refresh-token`, { refresh_token: refreshToken })
      .then(({ data }) => {
        storage.set(STORAGE_KEYS.ACCESS_TOKEN, data.access_token)
        storage.set(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token)
        return data.access_token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

axiosClient.interceptors.response.use(
  response => response,

  async error => {
    const status = error.response?.status
    const original = error.config
    const token = storage.get(STORAGE_KEYS.ACCESS_TOKEN)

    /*
     * Demo accounts use local fake tokens. The backend cannot validate
     * them, so a 401 must not log the demo user out.
     */
    const isDemoToken =
      typeof token === 'string' && token.startsWith('demo_access_token')
    if (isDemoToken) return Promise.reject(error)

    // Suspended / removed account: the backend says so with 403.
    if (
      status === 403
      && error.response?.data?.detail === 'Your account is inactive.'
      && !NO_REFRESH_PATHS.some(p => original?.url?.includes(p))
    ) {
      endSession()
      return Promise.reject(error)
    }

    if (status !== 401) return Promise.reject(error)

    const isAuthCall = NO_REFRESH_PATHS.some(p => original?.url?.includes(p))
    if (isAuthCall) return Promise.reject(error)

    // Access token expired: try one silent refresh, then repeat the request.
    if (!original._retried && storage.get(STORAGE_KEYS.REFRESH_TOKEN)) {
      original._retried = true
      try {
        const newToken = await refreshSession()
        original.headers.Authorization = `Bearer ${newToken}`
        return axiosClient(original)
      } catch {
        endSession()
        return Promise.reject(error)
      }
    }

    endSession()
    return Promise.reject(error)
  },
)


export default axiosClient