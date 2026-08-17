param(
  [string]$Workspace = 'D:\WisdomAI-React',
  [string]$WorkerId = 'local-windows-runner-01'
)

$ErrorActionPreference = 'Stop'
$endpoint = 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/automation-worker'
$credentialPath = Join-Path $env:LOCALAPPDATA 'WisdomAI\automation-worker.cred'
$logDirectory = Join-Path $env:LOCALAPPDATA 'WisdomAI\logs'
$schemaPath = Join-Path $Workspace 'scripts\automation-result.schema.json'
$codexPath = Join-Path $env:APPDATA 'npm\codex.cmd'
$mutex = New-Object System.Threading.Mutex($false, 'Local\WisdomAI-Local-Automation-Runner')
$locked = $false
$secret = $null
$secureSecret = $null
$secretPointer = [IntPtr]::Zero

function Invoke-Worker([hashtable]$Body, [string]$Secret) {
  $payload = $Body | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{ 'x-automation-worker-secret' = $Secret } `
    -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 45
}

function Finish-Run($Item, [string]$Secret, [string]$Status, [int]$Progress, [string]$Evidence, [string]$ProductionStatus, [string]$Fingerprint = '') {
  Invoke-Worker -Secret $Secret -Body @{
    action='finish'; worker_id=$WorkerId; run_id=$Item.run_id; status=$Status; progress=$Progress
    evidence=$Evidence; production_status=$ProductionStatus; error_fingerprint=$Fingerprint
  } | Out-Null
}

try {
  $locked = $mutex.WaitOne(0)
  if (-not $locked) { exit 0 }
  if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'Automation credential is not installed.' }
  if (-not (Test-Path -LiteralPath $codexPath)) { throw 'Codex CLI is not installed.' }
  if (-not (Test-Path -LiteralPath (Join-Path $Workspace '.git'))) { throw 'Workspace is not a Git repository.' }
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

  $encrypted = Get-Content -Raw -LiteralPath $credentialPath
  $secureSecret = ConvertTo-SecureString $encrypted
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  try {
    $claim = Invoke-Worker -Secret $secret -Body @{ action='claim'; worker_id=$WorkerId; lease_minutes=120 }
    $item = $claim.item
    if ($null -eq $item) { exit 0 }

    $unsafeText = "$($item.title) $($item.detail) $($item.category) $($item.risk)"
    $requiresApproval = $item.category -eq 'tenant' -or $item.risk -eq 'critical' -or
      $unsafeText -match '(?i)migration|secret|credential|permission|security|RLS|delete|drop|production schema'
    $hasMatchingApproval = $item.approval_status -eq 'approved' -and -not [string]::IsNullOrWhiteSpace([string]$item.approval_fingerprint)
    if ($requiresApproval -and -not $hasMatchingApproval) {
      Finish-Run $item $secret 'review' ([int]$item.progress) `
        'Local runner preflight: work requires explicit approval because it may change schema, secrets, permissions, security, or data.' `
        'awaiting_approval'
      exit 0
    }

    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $promptFile = Join-Path $env:TEMP "wisdomai-$($item.work_key)-$runStamp.prompt.txt"
    $resultFile = Join-Path $env:TEMP "wisdomai-$($item.work_key)-$runStamp.result.json"
    $stdoutFile = Join-Path $logDirectory "$($item.work_key)-$runStamp.stdout.log"
    $stderrFile = Join-Path $logDirectory "$($item.work_key)-$runStamp.stderr.log"
    $prompt = @"
Work item $($item.work_key): $($item.title)
Category: $($item.category); risk: $($item.risk); current progress: $($item.progress)%
Scope: $($item.detail)

Work only inside $Workspace. Inspect existing changes and preserve unrelated user work. Update the existing work item evidence rather than inventing duplicate tasks. Do not run database migrations, rotate or expose secrets, change permissions/security, delete data, or make irreversible changes. If any such action is required, stop and return status review. For safe source changes, use focused edits, run npm.cmd run lint, npm.cmd run build, and relevant tests. Do not deploy schema or security changes. Return the final result using the required JSON schema with concise evidence and an error fingerprint when blocked.
"@
    [IO.File]::WriteAllText($promptFile, $prompt, [Text.UTF8Encoding]::new($false))

    # --approve-for-me already enforces the workspace-write sandbox in current Codex CLI.
    # Passing an explicit --sandbox together with it is rejected before the task starts.
    $arguments = "/d /s /c `"type `"`"$promptFile`"`" | `"`"$codexPath`"`" exec - --ephemeral --approve-for-me --output-schema `"`"$schemaPath`"`" --output-last-message `"`"$resultFile`"`" -C `"`"$Workspace`"`"`""
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 60
      Invoke-Worker -Secret $secret -Body @{
        action='heartbeat'; worker_id=$WorkerId; run_id=$item.run_id; step='codex_exec';
        progress=[Math]::Min(95,[Math]::Max([int]$item.progress,50)); lease_minutes=120
      } | Out-Null
      $process.Refresh()
    }

    $result = $null
    if (Test-Path -LiteralPath $resultFile) {
      try {
        $result = Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json
      } catch {
        $result = $null
      }
    }

    # Codex can return a non-zero process code after it has already written a
    # schema-valid final result (for example when a late cleanup step fails).
    # The structured result is the authoritative completion signal.
    if ($null -eq $result) {
      $tail = if (Test-Path -LiteralPath $stderrFile) { (Get-Content $stderrFile -Tail 20) -join ' ' } else { 'No stderr output.' }
      $sha256 = [Security.Cryptography.SHA256]::Create()
      try {
        $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($tail))
        $fingerprint = (-join ($hash | ForEach-Object { $_.ToString('x2') })).Substring(0,24)
      } finally {
        $sha256.Dispose()
      }
      Finish-Run $item $secret 'blocked' ([int]$item.progress) "Codex CLI failed: $($tail.Substring(0,[Math]::Min(1500,$tail.Length)))" 'local_runner_failed' $fingerprint
      exit 1
    }

    Finish-Run $item $secret $result.status ([int]$result.progress) $result.evidence $result.production_status $result.error_fingerprint
  } finally {
    if ($secretPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
      $secretPointer = [IntPtr]::Zero
    }
    if ($secureSecret) { $secureSecret.Dispose() }
    $secret = $null
  }
} catch {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $message = "$(Get-Date -Format o) $($_.Exception.Message)"
  [IO.File]::AppendAllText((Join-Path $logDirectory 'runner-errors.log'),$message+[Environment]::NewLine)
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
