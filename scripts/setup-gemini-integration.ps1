param([Parameter(Mandatory = $true)][string]$ProjectRef)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretFile = Join-Path ([System.IO.Path]::GetTempPath()) "wisdomai-gemini-$([guid]::NewGuid().ToString('N')).env"

function Read-SecretText([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Set-Location $projectRoot
$geminiKey = Read-SecretText 'Gemini API key (input is hidden)'

try {
  @(
    "GEMINI_API_KEY=$geminiKey"
    'GEMINI_MODEL=gemini-3.5-flash-lite'
  ) | Set-Content -LiteralPath $secretFile -Encoding utf8

  npx.cmd supabase link --project-ref $ProjectRef
  npx.cmd supabase db push
  npx.cmd supabase secrets set --env-file $secretFile --project-ref $ProjectRef
  npx.cmd supabase functions deploy line-webhook --project-ref $ProjectRef --no-verify-jwt
  Write-Host 'Gemini LINE analysis is ready.' -ForegroundColor Green
  Write-Host 'Send a new LINE message, then open Summary LINE in WisdomAI.'
} finally {
  $geminiKey = $null
  if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile -Force }
}
