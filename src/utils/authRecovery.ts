export type AuthRecoveryUrlState = {
  hasRecoverySignal: boolean
  hasRecoveryError: boolean
  errorCode: string
  errorDescription: string
}

export function getAuthRecoveryUrlState(search = window.location.search, hash = window.location.hash): AuthRecoveryUrlState {
  const searchParams = new URLSearchParams(search.replace(/^\?/, ''))
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
  const type = hashParams.get('type') ?? searchParams.get('type') ?? ''
  const errorCode = hashParams.get('error_code') ?? searchParams.get('error_code') ?? hashParams.get('error') ?? searchParams.get('error') ?? ''
  const errorDescription = hashParams.get('error_description') ?? searchParams.get('error_description') ?? ''
  const hasTokenPair = Boolean((hashParams.get('access_token') || searchParams.get('access_token')) && (hashParams.get('refresh_token') || searchParams.get('refresh_token')))
  const hasPkceCode = Boolean(searchParams.get('code'))
  const hasRecoveryError = Boolean(errorCode)
  return {
    hasRecoverySignal: type === 'recovery' || hasTokenPair || hasPkceCode || hasRecoveryError,
    hasRecoveryError,
    errorCode,
    errorDescription: errorDescription.replace(/\+/g, ' '),
  }
}

export function shouldRouteToResetPassword(pathname = window.location.pathname, search = window.location.search, hash = window.location.hash) {
  return pathname !== '/reset-password' && getAuthRecoveryUrlState(search, hash).hasRecoverySignal
}

export function passwordResetRouteFromCurrentUrl(search = window.location.search, hash = window.location.hash) {
  return `/reset-password${search}${hash}`
}

export function clearSensitiveRecoveryUrl() {
  const state = getAuthRecoveryUrlState()
  if (!state.hasRecoverySignal || state.hasRecoveryError) return
  window.history.replaceState(window.history.state, document.title, '/reset-password')
}
