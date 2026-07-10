param(
  [int]$Port = 5173,
  [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$webRoot = Join-Path $repoRoot "apps\web"
$viteCmd = Join-Path $webRoot "node_modules\.bin\vite.cmd"
$logPath = Join-Path $repoRoot "web-preview-5173.log"
$errPath = Join-Path $repoRoot "web-preview-5173.err.log"
$url = "http://localhost:$Port/real-test"

function Test-PreviewUrl {
  param([string]$TargetUrl)
  try {
    $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Resolve-NodeBin {
  $bundledNode = "C:\Users\86178\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) {
    return Split-Path $bundledNode -Parent
  }

  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) {
    return Split-Path $nodeCommand.Source -Parent
  }

  throw "Node.js was not found. Run pnpm install in a terminal that has Node.js available, or update this script's bundled Node path."
}

if (Test-PreviewUrl $url) {
  Write-Host "Preview is already running: $url"
  exit 0
}

if (-not (Test-Path $viteCmd)) {
  throw "Vite executable was not found at $viteCmd. Run pnpm install first."
}

$nodeBin = Resolve-NodeBin

if ($Foreground) {
  $env:PATH = "$nodeBin;$env:PATH"
  Set-Location $webRoot
  & $viteCmd --host 0.0.0.0 --port $Port
  exit $LASTEXITCODE
}

$innerScript = @"
`$env:PATH = '$nodeBin;' + `$env:PATH
Set-Location '$webRoot'
& '$viteCmd' --host 0.0.0.0 --port $Port
"@
$encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($innerScript))

Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) `
  -WorkingDirectory $webRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath `
  -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds(18)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  if (Test-PreviewUrl $url) {
    Write-Host "Preview started: $url"
    Write-Host "Logs: $logPath"
    exit 0
  }
}

Write-Host "Preview did not respond on $url"
if (Test-Path $errPath) {
  Write-Host "Last error log lines:"
  Get-Content $errPath -Tail 30
}
exit 1