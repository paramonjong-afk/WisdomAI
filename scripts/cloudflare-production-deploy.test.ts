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
  "Import-DotEnvFile -Path (Join-Path $EnvironmentRoot '.env')",
  "Import-DotEnvFile -Path (Join-Path $EnvironmentRoot '.env.local')",
  "accounts/$AccountId/tokens/verify",
  "accounts/$AccountId/pages/projects/$ProjectName",
  "$env:CF_PAGES = '1'",
  "release.host -ne 'cloudflare'",
  "remoteRelease.revision -ne $revision",
  'PRODUCTION_DEPLOY_OK',
]

for (const contract of requiredContracts) {
  if (!script.includes(contract)) throw new Error(`Missing deploy safety contract: ${contract}`)
}

if (/Set-Content.+CLOUDFLARE_API_TOKEN/i.test(script)) throw new Error('Token must never be written to a file')
if (packageJson.scripts?.['deploy:cloudflare'] !== 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-cloudflare-production.ps1') {
  throw new Error('Missing canonical npm deploy:cloudflare command')
}
if (!flow.includes('Cloudflare Git Integration') || !flow.includes('emergency fallback')) {
  throw new Error('Release flow must make Git Integration primary and Token deployment fallback-only')
}
for (const contract of ['GitHub `main`', 'Cloudflare Git Integration', 'release.json', 'authenticated runtime smoke', 'ห้ามลอง Token เดิมซ้ำ']) {
  if (!playbook.includes(contract)) throw new Error(`Missing release incident playbook contract: ${contract}`)
}
if (!deploymentGuide.includes('only normal release path') || !deploymentGuide.includes('Manual fallback')) {
  throw new Error('Cloudflare deployment guide does not separate normal Git deploy from manual fallback')
}
if (!agents.includes('docs/RELEASE_INCIDENT_PLAYBOOK.md') || !agents.includes('emergency fallback only')) {
  throw new Error('AGENTS.md must require the release incident standard in every Codex thread')
}
for (const contract of ['name: Verify Cloudflare Pages Build', 'Cloudflare deployment handoff', 'connected Git integration']) {
  if (!workflow.includes(contract)) throw new Error(`GitHub workflow does not match Git-integrated release: ${contract}`)
}
if (workflow.includes('wrangler-action') || workflow.includes('secrets.CLOUDFLARE_API_TOKEN')) {
  throw new Error('Normal GitHub verification workflow must not depend on the manual Cloudflare Token path')
}

console.log('cloudflare release contract: PASS — Git integration primary, local Token fallback-only')
