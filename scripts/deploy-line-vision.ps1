$ErrorActionPreference = 'Stop'

$projectRef = 'xkieyqixlufjqructjkr'

Write-Host 'Deploying LINE webhook with Gemini Vision...'
npx.cmd supabase db push --include-all

if ($LASTEXITCODE -ne 0) {
  throw 'Database migration failed. Run: npx supabase login, then run this script again.'
}

npx.cmd supabase functions deploy line-webhook --project-ref $projectRef

if ($LASTEXITCODE -ne 0) {
  throw 'Supabase deployment failed. Run: npx supabase login, then run this script again.'
}

Write-Host ''
Write-Host 'Deployment complete.'
Write-Host 'Send a new image to the connected LINE group, then open the LINE work summary page and press Refresh.'
