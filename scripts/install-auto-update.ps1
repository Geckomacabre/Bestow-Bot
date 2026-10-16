<#
  Sets up automatic updates for a self-hosted Bestow on Windows: a "Bestow auto-update" scheduled task that runs auto-update.ps1 every
  few minutes (and when you sign in), which pulls new commits from GitHub's main branch and rebuilds the Docker container. It runs
  hidden, as you, while you are signed in (Docker Desktop only runs then), and starts once right away.

  From the bot's folder:
    powershell -ExecutionPolicy Bypass -File .\scripts\install-auto-update.ps1              # set it up (every 5 minutes)
    powershell -ExecutionPolicy Bypass -File .\scripts\install-auto-update.ps1 -Minutes 15  # check less often
    powershell -ExecutionPolicy Bypass -File .\scripts\install-auto-update.ps1 -Uninstall   # remove it
  (Plain ASCII on purpose: Windows PowerShell 5.1 misreads other characters in a script saved without a byte-order mark.)
#>
param([switch]$Uninstall, [ValidateRange(1, 1440)][int]$Minutes = 5)

$ErrorActionPreference = 'Stop'
$name = 'Bestow auto-update'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the '$name' task. Bestow keeps running; it just won't update itself any more."
  return
}

$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'auto-update.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  Write-Host "$root is not a git clone, so it can't update itself. Clone https://github.com/Geckomacabre/Bestow-Bot, copy your .env into it, and run this again from there."
  exit 1
}
foreach ($tool in 'git', 'docker') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Write-Host "$tool isn't installed (or isn't on PATH). Install it and run this again."; exit 1 }
}

# conhost --headless runs PowerShell with no window at all, so nothing flashes on screen every few minutes.
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $root `
  -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
$every = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$signIn = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($every, $signIn) -Settings $settings -Principal $principal -Force `
  -Description "Pulls new Bestow commits from GitHub and rebuilds the Docker container ($script)." | Out-Null
Start-ScheduledTask -TaskName $name

Write-Host "Done. '$name' checks GitHub every $Minutes minutes and when you sign in, and is running once now."
Write-Host "What it does is logged in $(Join-Path $root 'logs\auto-update.log')."
