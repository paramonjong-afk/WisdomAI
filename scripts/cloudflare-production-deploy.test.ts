import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const script = readFileSync(resolve(root, 'scripts/deploy-cloudflare-production.ps1'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
const flow = readFileSync(resolve(root, 'docs/RELEASE_PARITY_FLOW.md'), 'utf8')

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
if (!flow.includes('Account API Token') || !flow.includes('Production preflight')) {
  throw new Error('Release flow does not document the safe Cloudflare token path')
}

console.log('cloudflare production deploy contract: PASS')
