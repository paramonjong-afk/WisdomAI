import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

const versionBrandAsset = (url: string) => `${url}${url.includes('?') ? '&' : '?'}v=${release.revision}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wisdomai-release-manifest',
      transformIndexHtml(html) {
        return html
          .replace('/manifest.webmanifest"', `${versionBrandAsset('/manifest.webmanifest')}"`)
          .replace('/branding/wisdom-power-system-app-icon-32.png"', `${versionBrandAsset('/branding/wisdom-power-system-app-icon-32.png')}"`)
          .replace('/branding/wisdom-power-system-app-icon-180.png"', `${versionBrandAsset('/branding/wisdom-power-system-app-icon-180.png')}"`)
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: `${JSON.stringify(release, null, 2)}\n` })
        this.emitFile({ type: 'asset', fileName: 'release.js', source: `window.__WISDOMAI_RELEASE_MANIFEST__=${JSON.stringify(release)};\n` })
      },
      writeBundle(outputOptions) {
        const outputDirectory = outputOptions.dir ?? resolve(process.cwd(), 'dist')
        const manifestPath = resolve(outputDirectory, 'manifest.webmanifest')
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          icons?: Array<{ src: string }>
        }
        manifest.icons = manifest.icons?.map((icon) => ({
          ...icon,
          src: versionBrandAsset(icon.src),
        }))
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      },
    },
  ],
  define: {
    __WISDOMAI_RELEASE__: JSON.stringify(release),
  },
})
