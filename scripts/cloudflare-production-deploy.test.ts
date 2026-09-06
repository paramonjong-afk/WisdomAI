import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const script = readFileSync(resolve(root, 'scripts/deploy-cloudflare-production.ps1'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
const flow = readFileSync(resolve(root, 'docs/RELEASE_PARITY_FLOW.md'), 'utf8')
const playbook = readFileSync(resolve(root, 'docs/RELEASE_INCIDENT_PLAYBOOK.md'), 'utf8')
const deploymentGuide = readFileSync(resolve(root, 'docs/CLOUDFLARE_DEPLOYMENT.md'), 'utf8')
const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
const workflow = readFileSync(resolve(root, '.github/workflows/deploy-cloudflare-pages.yml'), 'utf8')

const requiredContracts = [
  "git status --porcelain",
  'git fetch origin main --quiet',
  'git rev-parse origin/main',
  '$commitHash -ne $originMain',
  '/release.json',
  "$release.host -eq 'cloudflare'",
  '$release.revision -eq $revision',
  'Cloudflare Automatic Deployment',
  'do not upload a locally built dist',
  'PRODUCTION_DEPLOY_OK',
]

for (const contract of requiredContracts) {
  if (!script.includes(contract)) throw new Error(`Missing deploy safety contract: ${contract}`)
}

for (const forbidden of ['Import-DotEnvFile', 'CLOUDFLARE_API_TOKEN', 'wrangler pages deploy', 'npm run build', 'VITE_SUPABASE_ANON_KEY']) {
  if (script.includes(forbidden)) throw new Error(`Deploy verifier must not use local build credentials/artifacts: ${forbidden}`)
}
if (packageJson.scripts?.['deploy:cloudflare'] !== 'npm run verify:cloudflare-production') {
  throw new Error('Legacy deploy command must delegate to the safe verifier')
}
if (packageJson.scripts?.['verify:cloudflare-production'] !== 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-cloudflare-production.ps1') {
  throw new Error('Missing canonical Cloudflare Production verifier')
}
if (!flow.includes('Cloudflare Git Integration') || !flow.includes('เส้นทางเดียว')) {
  throw new Error('Release flow must make Git Integration the only Production deploy path')
}
for (const contract of ['GitHub `main`', 'Cloudflare Git Integration', 'release.json', 'authenticated runtime smoke', 'ห้ามอัปโหลด local artifact']) {
  if (!playbook.includes(contract)) throw new Error(`Missing release incident playbook contract: ${contract}`)
}
if (!deploymentGuide.includes('only release path') || !deploymentGuide.includes('ห้าม Manual upload')) {
  throw new Error('Cloudflare deployment guide must require the single Git-integrated release path')
}
if (!agents.includes('docs/RELEASE_INCIDENT_PLAYBOOK.md') || !agents.includes('only Production deployment path')) {
  throw new Error('AGENTS.md must require the release incident standard in every Codex thread')
}
for (const contract of ['name: Verify Cloudflare Pages Build', 'Cloudflare deployment handoff', 'connected Git integration']) {
  if (!workflow.includes(contract)) throw new Error(`GitHub workflow does not match Git-integrated release: ${contract}`)
}
if (workflow.includes('wrangler-action') || workflow.includes('secrets.CLOUDFLARE_API_TOKEN')) {
  throw new Error('Normal GitHub verification workflow must not depend on the manual Cloudflare Token path')
}

console.log('cloudflare release contract: PASS — Git integration is the only deploy path')
