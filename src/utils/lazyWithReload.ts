import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

const reloadPrefix = 'wisdomai:chunk-reload:'
const retryWindowMs = 60_000

export const isDynamicImportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
    'ChunkLoadError',
    'Loading chunk',
  ].some((text) => message.includes(text))
}

export const lazyWithReload = <T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> => lazy(async () => {
  const key = `${reloadPrefix}${window.location.pathname}`
  try {
    const loaded = await importer()
    sessionStorage.removeItem(key)
    return loaded
  } catch (error) {
    if (!isDynamicImportError(error)) throw error

    const lastReload = Number(sessionStorage.getItem(key) ?? 0)
    if (!lastReload || Date.now() - lastReload > retryWindowMs) {
      sessionStorage.setItem(key, String(Date.now()))
      window.location.reload()
      return await new Promise<{ default: T }>(() => undefined)
    }

    sessionStorage.removeItem(key)
    throw error
  }
})

export const clearChunkReloadMarker = () => {
  sessionStorage.removeItem(`${reloadPrefix}${window.location.pathname}`)
}
