[CmdletBinding()]
param(
  [string]$ProductionUrl = 'https://wisdomai.pages.dev',
  [int]$TimeoutSeconds = 900,
  [int]$PollSeconds = 15
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Assert-LastExitCode {
  param([Parameter(Mandatory = $true)][string]$Step)
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}

function Get-RemoteRelease {
  param([Parameter(Mandatory = $true)][string]$BaseUrl)

  $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  return Invoke-RestMethod -Method Get -Uri "$BaseUrl/release.json?verify=$cacheBust" -Headers @{
    'Cache-Control' = 'no-cache'
    'Pragma' = 'no-cache'
  }
}

Set-Location -LiteralPath $repoRoot

$gitStatus = @(& git status --porcelain)
Assert-LastExitCode 'git status'
if ($gitStatus.Count -gt 0) {
  throw "Working tree is not clean. Commit or isolate the release before verification.`n$($gitStatus -join "`n")"
}

& git fetch origin main --quiet
Assert-LastExitCode 'git fetch origin main'

$commitHash = (& git rev-parse HEAD).Trim()
Assert-LastExitCode 'git commit lookup'
$originMain = (& git rev-parse origin/main).Trim()
Assert-LastExitCode 'origin/main lookup'
if ($commitHash -ne $originMain) {
  throw "HEAD ($commitHash) does not match origin/main ($originMain). Push or fast-forward safely before waiting for Production."
}

$revision = (& git rev-parse --short=7 HEAD).Trim()
Assert-LastExitCode 'git revision lookup'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$baseUrl = $ProductionUrl.TrimEnd('/')

Write-Host "Waiting for Cloudflare Git Integration: commit=$commitHash revision=$revision"
Write-Host 'Production variables are read by Cloudflare during its build; this script never reads local environment files or uploads local dist.'

do {
  try {
    $release = Get-RemoteRelease -BaseUrl $baseUrl
    Write-Host "Observed release: revision=$($release.revision) host=$($release.host)"
    if ($release.host -eq 'cloudflare' -and $release.revision -eq $revision) {
      $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $loginSmoke = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/login?verify=$cacheBust" -Headers @{
        'Cache-Control' = 'no-cache'
      }
      if ($loginSmoke.StatusCode -ne 200) {
        throw "Runtime smoke failed with HTTP $($loginSmoke.StatusCode)."
      }

      Write-Host "PRODUCTION_DEPLOY_OK url=$ProductionUrl revision=$revision host=cloudflare source=git-integration"
      exit 0
    }
  }
  catch {
    Write-Warning "Cloudflare release is not ready: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $PollSeconds
} while ((Get-Date) -lt $deadline)

throw "Timed out waiting for Cloudflare Automatic Deployment revision '$revision'. Inspect the Cloudflare Pages deployment for GitHub main; do not upload a locally built dist."
