import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const reloadPrefix = 'wisdomai:chunk-reload:'
const retryWindowMs = 60_000

const reloadKey = () => `${reloadPrefix}${window.location.pathname}`

export const isDynamicImportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
    'ChunkLoadError',
    'Loading chunk',
    'module script',
    'MIME type',
    'disallowed MIME',
  ].some((text) => message.includes(text))
}

const reloadOnce = () => {
  const key = reloadKey()
  const lastReload = Number(sessionStorage.getItem(key) ?? 0)
  if (lastReload && Date.now() - lastReload <= retryWindowMs) return false

  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
  return true
}

export const installChunkReloadRecovery = () => {
  window.addEventListener('vite:preloadError', (event) => {
    const preloadEvent = event as Event & { payload?: unknown }
    if (!isDynamicImportError(preloadEvent.payload)) return
    if (!reloadOnce()) return

    // Vite would otherwise rethrow the stale chunk error while the reload starts.
    event.preventDefault()
  })
}

export const lazyWithReload = <T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> => lazy(async () => {
  const key = reloadKey()
  try {
    const loaded = await importer()
    sessionStorage.removeItem(key)
    return loaded
  } catch (error) {
    if (!isDynamicImportError(error)) throw error

    if (reloadOnce()) {
      return await new Promise<{ default: T }>(() => undefined)
    }

    sessionStorage.removeItem(key)
    throw error
  }
})

export const clearChunkReloadMarker = () => {
  sessionStorage.removeItem(reloadKey())
}
