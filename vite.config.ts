import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

const gitRevision = () => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'local' }
}

const release = {
  version: process.env.npm_package_version ?? '0.0.0',
  revision: gitRevision(),
  builtAt: new Date().toISOString(),
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __WISDOMAI_RELEASE__: JSON.stringify(release),
  },
})
