import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const vite = readFileSync('vite.config.ts', 'utf8')
const topBar = readFileSync('src/layouts/TopBar.tsx', 'utf8')
const health = readFileSync('src/pages/SystemHealth/index.tsx', 'utf8')
const release = readFileSync('src/lib/releaseInfo.ts', 'utf8')

assert.ok(vite.includes('__WISDOMAI_RELEASE__'), 'Vite must inject release metadata at build time')
assert.ok(vite.includes("fileName: 'release.json'"), 'Vite must emit a readable release manifest')
assert.ok(vite.includes("fileName: 'release.js'"), 'Vite must emit a cross-origin release probe script')
assert.ok(release.includes('releaseLabel'), 'release metadata must expose a display label')
assert.ok(release.includes('releaseHostLabel'), 'release metadata must expose the serving host')
assert.ok(topBar.includes("navigate('/system-health')"), 'Top Bar release label must lead to System Health')
assert.ok(topBar.includes('releaseHostLabel'), 'Top Bar must show whether the page is served by Vercel or Cloudflare')
assert.ok(health.includes('Release ที่กำลังใช้งาน'), 'System Health must show release detail')
console.log('release indicator checks passed')
