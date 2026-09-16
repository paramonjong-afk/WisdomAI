param(
  [string]$ExecutionWorkspace = 'D:\WisdomAI-React\.codex-worktrees\controller-runner-production',
  [string]$QaWorkspace = 'D:\WisdomAI-React\.codex-worktrees\controller-qa-production'
)

$ErrorActionPreference = 'Stop'
$runner = Join-Path $ExecutionWorkspace 'scripts\local-automation-runner.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw 'Controller runner script is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $QaWorkspace '.git'))) { throw 'Controller QA workspace is missing.' }

$common = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass'
$execution = Start-Process powershell.exe -ArgumentList "$common -File `"$runner`" -Workspace `"$ExecutionWorkspace`" -WorkerId `"controller-00-execution-01`" -Mode execution" -PassThru -WindowStyle Hidden
$qa = Start-Process powershell.exe -ArgumentList "$common -File `"$runner`" -Workspace `"$QaWorkspace`" -WorkerId `"controller-00-qa-01`" -Mode qa" -PassThru -WindowStyle Hidden
Wait-Process -Id $execution.Id,$qa.Id
$execution.Refresh(); $qa.Refresh()
if ($execution.ExitCode -ne 0 -or $qa.ExitCode -ne 0) { exit 1 }
