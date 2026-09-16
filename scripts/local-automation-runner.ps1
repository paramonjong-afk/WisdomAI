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

function Finish-Run($Item, [string]$Secret, [string]$Status, [int]$Progress, [string]$Evidence, [string]$ProductionStatus, [string]$Fingerprint = '', [string]$Outcome = 'blocked', [string]$OutcomeReason = 'Worker did not provide a terminal outcome.', [string]$CurrentStep = 'stopped', [string]$ControlState = 'blocked', $Checkpoint = $null, [string]$ProblemCategory = 'unknown', [string]$NewInformationHash = '', [int]$TokenInput = 0, [int]$TokenOutput = 0, [decimal]$EstimatedCostUsd = 0, [decimal]$ActualCostUsd = 0, [bool]$CacheHit = $false) {
  if ($null -eq $Checkpoint) {
    $Checkpoint = @{ last_success='No durable milestone reported'; next_action=$CurrentStep; files=@(); evidence_refs=@() }
  }
  Invoke-Worker -Secret $Secret -Body @{
    action='finish'; worker_id=$WorkerId; run_id=$Item.run_id; status=$Status; progress=$Progress
    evidence=$Evidence; production_status=$ProductionStatus; error_fingerprint=$Fingerprint; outcome=$Outcome; outcome_reason=$OutcomeReason
    current_step=$CurrentStep; control_state=$ControlState; checkpoint=$Checkpoint
    context_manifest=$Item.context_manifest; problem_category=$ProblemCategory; new_information_hash=$NewInformationHash
    token_input=$TokenInput; token_output=$TokenOutput
    estimated_cost_usd=$EstimatedCostUsd; actual_cost_usd=$ActualCostUsd; cache_hit=$CacheHit
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
        'awaiting_approval' '' 'acknowledged' 'Worker acknowledged the task but stopped for the required explicit approval.' `
        'waiting_for_tool_or_business_approval' 'waiting_permission' `
        @{last_success='Preflight completed';next_action='Obtain the required scoped approval';files=@();evidence_refs=@()} 'allow'
      exit 0
    }

    $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $promptFile = Join-Path $env:TEMP "wisdomai-$($item.work_key)-$runStamp.prompt.txt"
    $resultFile = Join-Path $env:TEMP "wisdomai-$($item.work_key)-$runStamp.result.json"
    $stdoutFile = Join-Path $logDirectory "$($item.work_key)-$runStamp.stdout.log"
    $stderrFile = Join-Path $logDirectory "$($item.work_key)-$runStamp.stderr.log"
    $priorEvidence = [string]$item.evidence
    if ($priorEvidence.Length -gt 2000) { $priorEvidence = $priorEvidence.Substring($priorEvidence.Length - 2000) }
    $changedFiles = @(& git -C $Workspace diff --name-only HEAD 2>$null) | Select-Object -First 40
    $prompt = @"
Work item $($item.work_key): $($item.title)
Requirement version: $($item.requirement_version)
Category: $($item.category); risk: $($item.risk); recorded progress: $($item.progress)%
Model route: $($item.model_tier); QA tier: $($item.qa_tier); escalation level: $($item.escalation_level)
Token budget: input=$($item.token_budget_input), output=$($item.token_budget_output), soft limit=$($item.token_soft_limit_percent)%
Prompt/schema version: $($item.prompt_version)/$($item.output_schema_version)
Scope: $($item.detail)
Checkpoint: $($item.checkpoint | ConvertTo-Json -Depth 8 -Compress)
Context manifest: $($item.context_manifest | ConvertTo-Json -Depth 8 -Compress)
Current changed files (diff-first, maximum 40): $($changedFiles -join ', ')
Prior evidence tail (maximum 2000 chars): $priorEvidence

Use only this task packet first. Open additional files only when the context manifest or direct evidence makes them necessary; do not load full chat history. Resume from the checkpoint instead of restarting completed work. Work only inside $Workspace. Preserve unrelated changes. Do not run database migrations, rotate or expose secrets, change permissions/security, delete data, or make irreversible changes. If permission is required, return waiting_permission with a checkpoint. If the context/token limit prevents safe completion, return token_limit with a checkpoint. For safe source changes, use focused edits and relevant verification. Return the final result using the required JSON schema, including checkpoint, control_state, problem_category, new_information_hash and token counts (use 0 when unavailable). Same task + same error + same requirement version + no new information must not be retried.
"@
    [IO.File]::WriteAllText($promptFile, $prompt, [Text.UTF8Encoding]::new($false))

    # --approve-for-me already enforces the workspace-write sandbox in current Codex CLI.
    # Passing an explicit --sandbox together with it is rejected before the task starts.
    $configuredModel = switch ([string]$item.model_tier) {
      'economy' { $env:WISDOMAI_MODEL_ECONOMY }
      'reasoning' { $env:WISDOMAI_MODEL_REASONING }
      default { $env:WISDOMAI_MODEL_BALANCED }
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$item.model_name)) { $configuredModel = [string]$item.model_name }
    $modelArgument = if ([string]::IsNullOrWhiteSpace($configuredModel)) { '' } else { " --model `"`"$configuredModel`"`"" }
    $arguments = "/d /s /c `"type `"`"$promptFile`"`" | `"`"$codexPath`"`" exec - --ephemeral --approve-for-me$modelArgument --output-schema `"`"$schemaPath`"`" --output-last-message `"`"$resultFile`"`" -C `"`"$Workspace`"`"`""
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 60
      Invoke-Worker -Secret $secret -Body @{
        action='heartbeat'; worker_id=$WorkerId; run_id=$item.run_id; step='codex_exec';
        progress=[Math]::Min(95,[Math]::Max([int]$item.progress,0)); lease_minutes=120
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
      # Keep the END of the tail, not the start: when the prompt itself is long
      # (a detailed work item description), the last-20-lines tail can be
      # dominated by Codex echoing that prompt back, pushing the actual error
      # message past a head-truncated cutoff and leaving evidence useless for
      # diagnosis. The real failure is almost always at the very end.
      $tailStart = [Math]::Max(0, $tail.Length - 1500)
      Finish-Run $item $secret 'blocked' ([int]$item.progress) "Codex CLI failed: $($tail.Substring($tailStart))" 'local_runner_failed' $fingerprint 'no_output' 'Codex CLI ended without a schema-valid terminal result.' `
        'runner_failed_without_result' 'blocked' @{last_success='Worker process started';next_action='Diagnose runner failure before retry';files=@();evidence_refs=@($stderrFile)} 'unknown'
      exit 1
    }

    $budgetExceeded = ([int]$result.token_input -gt [int]$item.token_budget_input) -or ([int]$result.token_output -gt [int]$item.token_budget_output)
    if ($budgetExceeded) {
      $result.status = 'blocked'
      $result.control_state = 'token_limit'
      $result.outcome = 'blocked'
      $result.outcome_reason = "Worker exceeded the assigned token budget; resume from checkpoint after Controller review."
      $result.current_step = 'stopped_at_token_budget'
    }
    Finish-Run $item $secret $result.status ([int]$result.progress) $result.evidence $result.production_status $result.error_fingerprint $result.outcome $result.outcome_reason `
      $result.current_step $result.control_state $result.checkpoint $result.problem_category $result.new_information_hash ([int]$result.token_input) ([int]$result.token_output) `
      ([decimal]$result.estimated_cost_usd) ([decimal]$result.actual_cost_usd) ([bool]$result.cache_hit)
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
