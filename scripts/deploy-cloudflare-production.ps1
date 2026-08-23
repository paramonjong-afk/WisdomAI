[CmdletBinding()]
param(
  [string]$ProjectName = 'wisdomai',
  [string]$AccountId = $env:CLOUDFLARE_ACCOUNT_ID,
  [string]$EnvironmentRoot = '',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvironmentRoot) { $EnvironmentRoot = $repoRoot }
$EnvironmentRoot = (Resolve-Path -LiteralPath $EnvironmentRoot).Path
if (-not $AccountId) { $AccountId = '41eaced0cb627a4a9e7117bca1cf394d' }

function Import-DotEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^\s*([^#][^=]*)=(.*)$') { continue }
    $name = $matches[1].Trim()
    $value = $matches[2].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

function Assert-LastExitCode {
  param([Parameter(Mandatory = $true)][string]$Step)
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

$originalToken = $env:CLOUDFLARE_API_TOKEN
$originalAccountId = $env:CLOUDFLARE_ACCOUNT_ID
$originalCfPages = $env:CF_PAGES
$originalSupabaseUrl = $env:VITE_SUPABASE_URL
$originalSupabaseKey = $env:VITE_SUPABASE_ANON_KEY
$promptedToken = $false

try {
  Set-Location -LiteralPath $repoRoot

  $gitStatus = @(& git status --porcelain)
  Assert-LastExitCode 'git status'
  if ($gitStatus.Count -gt 0) {
    throw "Working tree is not clean. Commit or isolate the release in a clean worktree before Production deploy.`n$($gitStatus -join "`n")"
  }

  $revision = (& git rev-parse --short=7 HEAD).Trim()
  Assert-LastExitCode 'git revision lookup'
  $commitHash = (& git rev-parse HEAD).Trim()
  Assert-LastExitCode 'git commit lookup'

  # Load the base environment first, then local overrides. Explicit process values
  # supplied by CI/operator remain authoritative.
  Import-DotEnvFile -Path (Join-Path $EnvironmentRoot '.env')
  Import-DotEnvFile -Path (Join-Path $EnvironmentRoot '.env.local')
  if ($originalSupabaseUrl) { $env:VITE_SUPABASE_URL = $originalSupabaseUrl }
  if ($originalSupabaseKey) { $env:VITE_SUPABASE_ANON_KEY = $originalSupabaseKey }

  if (-not $env:VITE_SUPABASE_URL -or -not $env:VITE_SUPABASE_ANON_KEY) {
    throw 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Production build was not started.'
  }
  try { $supabaseUri = [uri]$env:VITE_SUPABASE_URL } catch { throw 'VITE_SUPABASE_URL is not a valid URL.' }
  if ($supabaseUri.Scheme -ne 'https' -or $supabaseUri.Host -notlike '*.supabase.co') {
    throw 'VITE_SUPABASE_URL must be an HTTPS Supabase project URL.'
  }
  if ($env:VITE_SUPABASE_ANON_KEY.Length -lt 20) { throw 'VITE_SUPABASE_ANON_KEY is invalid or incomplete.' }

  if (-not $AccountId) {
    throw 'Missing CLOUDFLARE_ACCOUNT_ID. Set it for the Cloudflare account that owns the Pages project.'
  }
  $env:CLOUDFLARE_ACCOUNT_ID = $AccountId

  if (-not $env:CLOUDFLARE_API_TOKEN) {
    $secureToken = Read-Host 'Cloudflare Account API Token' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { $env:CLOUDFLARE_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    $promptedToken = $true
  }
  if (-not $env:CLOUDFLARE_API_TOKEN) { throw 'Cloudflare Account API Token was not provided.' }

  $headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }
  $verifyUrl = "https://api.cloudflare.com/client/v4/accounts/$AccountId/tokens/verify"
  $tokenCheck = Invoke-RestMethod -Method Get -Uri $verifyUrl -Headers $headers
  if (-not $tokenCheck.success -or $tokenCheck.result.status -ne 'active') {
    throw 'Cloudflare Account API Token is not active for this account.'
  }

  # This distinguishes an Account token with Pages Write access from a User token
  # that may pass the user-token verify endpoint but still fail Pages deployment.
  $projectUrl = "https://api.cloudflare.com/client/v4/accounts/$AccountId/pages/projects/$ProjectName"
  $projectCheck = Invoke-RestMethod -Method Get -Uri $projectUrl -Headers $headers
  if (-not $projectCheck.success -or $projectCheck.result.name -ne $ProjectName) {
    throw "Token cannot access Cloudflare Pages project '$ProjectName'."
  }

  $env:CF_PAGES = '1'
  Write-Host "Validated Cloudflare Account token and Pages project '$ProjectName'."
  Write-Host "Release commit: $commitHash"

  & npm run lint
  Assert-LastExitCode 'lint'
  & npm run typecheck
  Assert-LastExitCode 'typecheck'
  & npm run build
  Assert-LastExitCode 'build'

  $releasePath = Join-Path $repoRoot 'dist/release.json'
  if (-not (Test-Path -LiteralPath $releasePath)) { throw 'dist/release.json was not generated.' }
  $release = Get-Content -Raw -LiteralPath $releasePath | ConvertFrom-Json
  if ($release.host -ne 'cloudflare') { throw "Release host is '$($release.host)', expected 'cloudflare'." }
  if ($release.revision -ne $revision) { throw "Release revision '$($release.revision)' does not match '$revision'." }

  $deployOutput = (& npx wrangler pages deploy dist --project-name $ProjectName --branch $Branch --commit-hash $commitHash 2>&1 | Out-String)
  Assert-LastExitCode 'Cloudflare Pages deploy'
  Write-Host $deployOutput.Trim()

  $deploymentUrl = [regex]::Match($deployOutput, 'https://[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev').Value
  if (-not $deploymentUrl) { throw 'Deployment completed but the revision URL was not found.' }

  $remoteRelease = Invoke-RestMethod -Method Get -Uri "$deploymentUrl/release.json"
  if ($remoteRelease.revision -ne $revision -or $remoteRelease.host -ne 'cloudflare') {
    throw 'Remote release manifest does not match the deployed commit/host.'
  }
  $loginSmoke = Invoke-WebRequest -UseBasicParsing -Uri "$deploymentUrl/login"
  if ($loginSmoke.StatusCode -ne 200) { throw "Runtime smoke failed with HTTP $($loginSmoke.StatusCode)." }

  Write-Host "PRODUCTION_DEPLOY_OK url=$deploymentUrl revision=$revision host=cloudflare"
}
finally {
  if ($null -eq $originalToken) { Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue }
  else { $env:CLOUDFLARE_API_TOKEN = $originalToken }
  if ($null -eq $originalAccountId) { Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue }
  else { $env:CLOUDFLARE_ACCOUNT_ID = $originalAccountId }
  if ($null -eq $originalCfPages) { Remove-Item Env:CF_PAGES -ErrorAction SilentlyContinue }
  else { $env:CF_PAGES = $originalCfPages }
  if ($promptedToken) { $secureToken = $null }
}
