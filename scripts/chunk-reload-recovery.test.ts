import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const recovery = readFileSync(resolve(root, 'src/utils/lazyWithReload.ts'), 'utf8')
const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')

for (const errorText of [
  'Failed to fetch dynamically imported module',
  'module script',
  'MIME type',
  'disallowed MIME',
]) {
  if (!recovery.includes(errorText)) throw new Error(`Missing stale chunk error contract: ${errorText}`)
}

for (const contract of [
  "window.addEventListener('vite:preloadError'",
  'event.preventDefault()',
  'retryWindowMs',
  'window.location.reload()',
]) {
  if (!recovery.includes(contract)) throw new Error(`Missing chunk recovery contract: ${contract}`)
}

if (!main.includes('installChunkReloadRecovery()')) {
  throw new Error('Chunk recovery must be installed before the React application renders')
}

console.log('chunk reload recovery contract: PASS')
