import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variable.')
}

const asciiHeaderValue = (value: string) =>
  [...value].filter((character) => {
    const code = character.charCodeAt(0)
    return code === 9 || (code >= 32 && code <= 126)
  }).join('')

declare global {
  interface Window {
    __wisdomAiHeadersCompatibilityInstalled?: boolean
  }
}

const emitRequestError = (input: RequestInfo | URL, status: number, statusText: string) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const url = new URL(rawUrl, window.location.origin)
    if (url.pathname.includes('/app_activity_logs') || url.pathname.includes('/rpc/register_client_error_event')) return
    window.dispatchEvent(new CustomEvent('wisdomai-request-error', {
      detail: { path: url.pathname.slice(0, 240), status, statusText: statusText.slice(0, 160) },
    }))
  } catch {
    window.dispatchEvent(new CustomEvent('wisdomai-request-error', {
      detail: { path: 'unknown-request', status, statusText: statusText.slice(0, 160) },
    }))
  }
}

if (!window.__wisdomAiHeadersCompatibilityInstalled) {
  const originalSet = Headers.prototype.set
  const originalAppend = Headers.prototype.append
  Headers.prototype.set = function set(name: string, value: string) {
    return originalSet.call(this, asciiHeaderValue(String(name)), asciiHeaderValue(String(value)))
  }
  Headers.prototype.append = function append(name: string, value: string) {
    return originalAppend.call(this, asciiHeaderValue(String(name)), asciiHeaderValue(String(value)))
  }
  window.__wisdomAiHeadersCompatibilityInstalled = true
}

// Older Samsung WebView versions reject RequestInit header values containing
// any non ISO-8859-1 code point. Sanitize SDK-generated headers before the
// browser constructs a Request so authentication remains compatible.
const compatibleFetch: typeof fetch = async (input, init) => {
  const headers: Record<string, string> = {}
  const addHeader = (key: string, value: string) => {
    const safeKey = asciiHeaderValue(key)
    if (safeKey) headers[safeKey] = asciiHeaderValue(value)
  }
  if (init?.headers instanceof Headers) {
    init.headers.forEach((value, key) => addHeader(key, value))
  } else if (Array.isArray(init?.headers)) {
    init.headers.forEach(([key, value]) => addHeader(String(key), String(value)))
  } else if (init?.headers) {
    Object.entries(init.headers).forEach(([key, value]) => addHeader(key, String(value)))
  }
  try {
    const response = await fetch(input, init?.headers ? { ...init, headers } : init)
    if (!response.ok) emitRequestError(input, response.status, response.statusText || 'HTTP request failed')
    return response
  } catch (error) {
    emitRequestError(input, 0, error instanceof Error ? error.message : 'Network request failed')
    throw error
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: compatibleFetch,
  },
})
