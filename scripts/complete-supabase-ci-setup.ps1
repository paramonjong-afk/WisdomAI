[CmdletBinding()]
param([switch]$Push)

$ErrorActionPreference = 'Stop'
$repository = 'paramonjong-afk/WisdomAI'
$taskBranch = 'codex/supabase-migration-safety-gate'
$projectReference = 'xkieyqixlufjqructjkr'
$workspace = Split-Path -Parent $PSScriptRoot

function Invoke-GhChecked {
    param([string[]]$GhArguments)
    & gh @GhArguments
    if ($LASTEXITCODE -ne 0) { throw 'GitHub command failed. No subsequent step was run.' }
}

Push-Location -LiteralPath $workspace
try {
    Invoke-GhChecked -GhArguments @('auth', 'status')
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne $taskBranch) {
        throw "Run only from branch $taskBranch."
    }
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Working tree must be clean before setup/push.' }
    $secretJson = & gh secret list --repo $repository --json name
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read repository secret names.' }
    $knownNames = @($secretJson | ConvertFrom-Json | ForEach-Object { $_.name })

    foreach ($name in @('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF')) {
        if ($knownNames -contains $name) {
            Write-Host "$name already exists; preserved."
            continue
        }
        if ($name -eq 'SUPABASE_PROJECT_REF') {
            Invoke-GhChecked -GhArguments @('secret', 'set', $name, '--repo', $repository, '--body', $projectReference)
        } else {
            Write-Host "Enter $name in GitHub CLI's prompt. It will be saved only as a GitHub Actions repository secret."
            # Let GitHub CLI own the secret prompt; never capture values in script variables or files.
            Invoke-GhChecked -GhArguments @('secret', 'set', $name, '--repo', $repository)
        }
    }
    Invoke-GhChecked -GhArguments @('secret', 'list', '--repo', $repository)
    if ($Push) {
        & git push origin "HEAD:refs/heads/$taskBranch"
        if ($LASTEXITCODE -ne 0) { throw 'Task branch push failed. Nothing was merged.' }
        Write-Host 'Task branch pushed. Inspect the new PR checks; do not merge until verified.'
    } else {
        Write-Host 'Secret setup complete. No Git branch was pushed.'
    }
    Write-Host "https://github.com/$repository/pull/28"
} finally {
    Pop-Location
}
