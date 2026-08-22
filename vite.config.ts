import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

const gitRevision = () => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'local' }
}

const deploymentHost = () => {
  if (process.env.VERCEL === '1') return 'vercel'
  if (process.env.CF_PAGES === '1') return 'cloudflare'
  return 'local'
}

const release = {
  version: process.env.npm_package_version ?? '0.0.0',
  revision: gitRevision(),
  builtAt: new Date().toISOString(),
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  host: deploymentHost(),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wisdomai-release-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: `${JSON.stringify(release, null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'release.js', source: `window.__WISDOMAI_RELEASE_MANIFEST__=${JSON.stringify(release)};\n` })
      },
    },
  ],
  define: {
    __WISDOMAI_RELEASE__: JSON.stringify(release),
  },
})
