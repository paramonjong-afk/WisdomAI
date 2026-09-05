[CmdletBinding()]
param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/pg/package.json'))) {
    throw 'Local PostgreSQL client is missing. Install dependencies before opening this tool.'
}
$form = New-Object System.Windows.Forms.Form
$form.Text = 'WisdomAI - One password check'
$form.Size = New-Object System.Drawing.Size(620, 370)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(20, 20)
$label.Size = New-Object System.Drawing.Size(570, 85)
$label.Text = "WisdomAI database only - session pooler (IPv4 reachable).`r`nOne attempt. SELECT 1 only. No data changes or password saving.`r`nStop if wrong. Multiple failures can block your IP.`r`nEnter only a password you believe is correct."
$form.Controls.Add($label)
$passwordBox = New-Object System.Windows.Forms.TextBox
$passwordBox.Location = New-Object System.Drawing.Point(20, 115)
$passwordBox.Size = New-Object System.Drawing.Size(565, 28)
$passwordBox.UseSystemPasswordChar = $true
$passwordBox.MaxLength = 1024
$form.Controls.Add($passwordBox)
$button = New-Object System.Windows.Forms.Button
$button.Location = New-Object System.Drawing.Point(20, 155)
$button.Size = New-Object System.Drawing.Size(180, 35)
$button.Text = 'Test ONCE (read-only)'
$form.Controls.Add($button)
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20, 205)
$status.Size = New-Object System.Drawing.Size(565, 100)
$status.Text = 'Ready. Nothing has connected yet. Password stays in process memory only.'
$form.Controls.Add($status)
$marker = Join-Path $PSScriptRoot '.last-attempt'
$worker = Join-Path $PSScriptRoot 'probe.mjs'
$button.Add_Click({
    if (-not $passwordBox.Text) { $status.Text = 'Enter a password first.'; return }
    $button.Enabled = $false
    $process = $null
    try {
        if (Test-Path -LiteralPath $marker) {
            $last = [DateTime]::Parse((Get-Content -LiteralPath $marker -Raw)).ToUniversalTime()
            if ([DateTime]::UtcNow -lt $last.AddMinutes(30)) {
                $status.Text = 'STOP: a local attempt was made within 30 minutes. Do not keep guessing.'
                return
            }
        }
        # Exclusive file lock prevents simultaneous windows from authenticating.
        $lock = [IO.File]::Open($marker, 'OpenOrCreate', 'ReadWrite', 'None')
        try {
            $reader = New-Object IO.StreamReader($lock, [Text.Encoding]::UTF8, $true, 1024, $true)
            $prior = $reader.ReadToEnd()
            $reader.Dispose()
            if ($prior -and [DateTime]::UtcNow -lt ([DateTime]::Parse($prior)).ToUniversalTime().AddMinutes(30)) {
                $status.Text = 'STOP: another window already attempted a connection.'
                return
            }
            $bytes = [Text.Encoding]::UTF8.GetBytes([DateTime]::UtcNow.ToString('o'))
            $lock.SetLength(0)
            $lock.Position = 0
            $lock.Write($bytes, 0, $bytes.Length)
        } finally { $lock.Dispose() }
        $status.Text = 'Checking once. Please wait up to 15 seconds...'
        $form.Refresh()
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $node
        $info.Arguments = '"' + $worker + '"'
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        foreach ($key in @($info.EnvironmentVariables.Keys)) {
            if ($key -like 'PG*' -or $key -like 'NODE_*') { $info.EnvironmentVariables.Remove($key) }
        }
        $process = New-Object Diagnostics.Process
        $process.StartInfo = $info
        [void]$process.Start()
        $process.StandardInput.WriteLine((@{password=$passwordBox.Text} | ConvertTo-Json -Compress))
        $process.StandardInput.Close()
        $passwordBox.Clear()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            $status.Text = 'TIMEOUT. Stopped. This does not prove the password is wrong. Do not retry.'
            return
        }
        $result = $process.StandardOutput.ReadToEnd().Trim()
        $status.Text = switch ($result) {
            'CONNECTED_READ_ONLY' { 'SUCCESS: password accepted and SELECT 1 passed. No data changed. Save it in GitHub SUPABASE_DB_PASSWORD yourself.' }
            'PASSWORD_REJECTED_STOP' { 'PASSWORD REJECTED. STOP. Do not guess again. No data changed.' }
            'TLS_CERTIFICATE_BLOCKED' { 'TLS certificate could not be verified. Password not confirmed. Do not disable SSL verification.' }
            'NETWORK_UNREACHABLE' { 'Session pooler is not reachable (network / DNS / firewall). Password not confirmed.' }
            default { 'Connection not verified. Do not assume a wrong password. Ask for diagnosis; no retry was made.' }
        }
    } catch {
        $status.Text = 'Local test could not complete. Password not confirmed. No automatic retry.'
    } finally {
        $passwordBox.Clear()
        $passwordBox.Enabled = $false
        if ($process) { $process.Dispose() }
    }
})
if ($ValidateOnly) { $form.Dispose(); Write-Output 'Password test UI constructed successfully; no connection attempted.'; exit 0 }
[void]$form.ShowDialog()
$form.Dispose()
