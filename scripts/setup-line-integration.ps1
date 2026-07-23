param([Parameter(Mandatory = $true)][string]$ProjectRef)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretFile = Join-Path ([System.IO.Path]::GetTempPath()) "wisdomai-line-$([guid]::NewGuid().ToString('N')).env"

function Read-SecretText([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Set-Location $projectRoot
Write-Host 'Checking Supabase access...'
npx.cmd supabase projects list | Out-Null
$lineSecret = Read-SecretText 'LINE Channel Secret'
$lineToken = Read-SecretText 'LINE Channel Access Token'

try {
  @("LINE_CHANNEL_SECRET=$lineSecret", "LINE_CHANNEL_ACCESS_TOKEN=$lineToken") |
    Set-Content -LiteralPath $secretFile -Encoding utf8
  npx.cmd supabase link --project-ref $ProjectRef
  npx.cmd supabase db push
  npx.cmd supabase secrets set --env-file $secretFile --project-ref $ProjectRef
  npx.cmd supabase functions deploy line-webhook --project-ref $ProjectRef --no-verify-jwt
  npx.cmd supabase functions deploy attendance-clock --project-ref $ProjectRef --no-verify-jwt
  Write-Host 'Setup complete.' -ForegroundColor Green
  Write-Host "Webhook URL: https://$ProjectRef.supabase.co/functions/v1/line-webhook"
  Write-Host 'The attendance-clock function is deployed with login-token verification.'
} finally {
  $lineSecret = $null
  $lineToken = $null
  if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force }
}
