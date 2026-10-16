<#
  Keeps a self-hosted Bestow up to date on Windows: when GitHub's main branch has new commits, it pulls them and rebuilds and restarts
  the Docker container (docker compose up -d --build). The "Bestow auto-update" scheduled task that install-auto-update.ps1 sets up runs
  it every few minutes; you can also run it yourself. It never overwrites your own changes: if the pull can't simply move forward, it
  logs why and leaves everything as it is.

  What it did is written to logs\auto-update.log in the bot's folder. -Force rebuilds even when nothing is new.
  (Plain ASCII on purpose: Windows PowerShell 5.1 misreads other characters in a script saved without a byte-order mark.)
#>
param([switch]$Force)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'auto-update.log'
$deployedFile = Join-Path $logDir 'auto-update.deployed'   # the commit that is running
$failedFile = Join-Path $logDir 'auto-update.failed'       # "<commit> <unix time>" of the last build that failed
$retryAfterFailure = 3600                                   # seconds before a commit whose build failed is tried again

function Write-Log([string]$message) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -LiteralPath $log -Value $line
  Write-Host $line
}

if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1MB) {
  $tail = Get-Content -LiteralPath $log -Tail 2000
  Set-Content -LiteralPath $log -Value $tail
}

# One run at a time: a second one finds the lock taken and quietly leaves.
try { $lock = [System.IO.File]::Open((Join-Path $logDir 'auto-update.lock'), 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }

try {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Log 'git is not installed (or not on PATH), so I cannot update.'; exit 1 }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Write-Log 'docker is not installed (or not on PATH), so I cannot rebuild.'; exit 1 }
  if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
    Write-Log "$root is not a git clone, so it can't be updated with git. Clone https://github.com/Geckomacabre/Bestow-Bot and run the bot from that folder."
    exit 1
  }

  $branch = "$(git rev-parse --abbrev-ref HEAD)".Trim()
  if ($branch -ne 'main') { Write-Log "On branch '$branch', not main: leaving it alone."; exit 0 }

  git fetch --quiet origin main
  if ($LASTEXITCODE -ne 0) { Write-Log 'git fetch failed (no internet?). Trying again next time.'; exit 1 }
  $remote = "$(git rev-parse origin/main)".Trim()
  $short = $remote.Substring(0, 7)
  $deployed = if (Test-Path -LiteralPath $deployedFile) { (Get-Content -LiteralPath $deployedFile -Raw).Trim() } else { '' }
  if ($remote -eq $deployed -and -not $Force) { exit 0 }   # already running the latest: nothing to say

  if (-not $Force -and (Test-Path -LiteralPath $failedFile)) {
    $failed = (Get-Content -LiteralPath $failedFile -Raw).Trim().Split(' ')
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ($failed[0] -eq $remote -and ($now - [long]$failed[1]) -lt $retryAfterFailure) { exit 0 }   # failed recently: wait a while
  }

  # Docker before git: pulling without being able to rebuild would leave the code and the running bot out of step.
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Write-Log 'Docker is not running (start Docker Desktop). Trying again next time.'; exit 1 }

  $local = "$(git rev-parse HEAD)".Trim()
  if ($local -ne $remote) {
    $pull = git merge --ff-only origin/main 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      Write-Log "Can't update to $short without touching changes made in this folder, so nothing was changed. git said: $($pull.Trim())"
      Write-Log "Changes here: $((git status --short | Out-String).Trim())"
      exit 1
    }
    Write-Log "Pulled $short ($("$(git log -1 --format=%s)".Trim()))."
  }

  Write-Log "Rebuilding and restarting the bot at $short..."
  $build = docker compose up -d --build 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Log "The rebuild failed; the bot keeps running its previous version. I'll try $short again in an hour. Last lines:"
    $build | Select-Object -Last 25 | ForEach-Object { Write-Log "  $_" }
    Set-Content -LiteralPath $failedFile -Value ('{0} {1}' -f $remote, [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    exit 1
  }
  Set-Content -LiteralPath $deployedFile -Value $remote
  if (Test-Path -LiteralPath $failedFile) { Remove-Item -LiteralPath $failedFile }
  docker image prune -f *> $null   # the images each rebuild leaves behind (only unused ones)
  Write-Log "Bestow is running $short."
  exit 0
} finally {
  $lock.Close()
}
