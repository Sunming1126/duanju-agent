param([string]$Server = "duanju-server", [switch]$PrepareOnly)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ($Server -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]*$') { throw "Use an SSH host alias from your own SSH config." }

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE; deployment stopped." }
}

# Uses the operator's ordinary terminal permissions and existing SSH credentials.
# Do not upload keys, local configuration, ignored files, or local work databases.
if (-not $PrepareOnly) {
    Invoke-Checked -Program "ssh" -Arguments @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10", $Server, "true")
    Invoke-Checked -Program "python" -Arguments @("tools/collab_sync.py", "finish", "-m", "sync approved Plotloom deployment")
}
$sourceCommit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw "Cannot identify the source commit." }
$dirty = & git status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw "Working tree must be clean before deployment." }

$checkPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $checkPython)) { throw "Project virtual environment is missing: $checkPython" }
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$testDirectory = "data/deploy-checks-$stamp-$($sourceCommit.Substring(0, 8))"
Invoke-Checked -Program $checkPython -Arguments @("-m", "pytest", "-q", "tests/test_writing_modes.py", "tests/test_inspiration.py", "tests/test_plotloom_mvp.py", "tests/test_studio.py", "test_market_features.py", "test_trilang_samples.py", "test_japan_adaptation.py", "--basetemp", $testDirectory, "-p", "no:cacheprovider")

Push-Location -LiteralPath (Join-Path $projectRoot "ai-website-cloner-template")
try {
    Invoke-Checked -Program "node" -Arguments @("--test", "scripts/studio.test.mjs", "scripts/inspiration.test.mjs", "scripts/writing.test.mjs")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "lint")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "typecheck")
} finally { Pop-Location }

$bundleDirectory = Join-Path $projectRoot "data\deployment-bundles"
New-Item -ItemType Directory -Path $bundleDirectory -Force | Out-Null
$bundleName = "plotloom-$stamp-$($sourceCommit.Substring(0, 12))"
$archive = Join-Path $bundleDirectory "$bundleName.zip"
$releaseRunner = Join-Path $bundleDirectory "$bundleName.sh"
Invoke-Checked -Program "git" -Arguments @("archive", "--format=zip", "--output=$archive", $sourceCommit)

# Extract the runner from the exact committed archive, not a changing worktree.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($entry in $zip.Entries) {
        $entryName = $entry.FullName
        if ($entryName.StartsWith("/") -or ($entryName.Split('/') -contains "..")) { throw "Unsafe archive path." }
        if ($entryName -match '(^|/)(\.git|node_modules|\.next|\.venv)/' -or $entryName -match '(^|/)\.env$|\.(pem|key)$') { throw "Runtime or credential file in archive: $entryName" }
        if ($entryName.StartsWith("data/") -and -not $entryName.EndsWith("/") -and $entryName -notin @("data/corpus.json", "data/llm_config.example.json")) { throw "Local data in archive: $entryName" }
    }
    $runnerEntry = $zip.GetEntry("tools/plotloom_deploy_release.sh")
    if (-not $runnerEntry) { throw "Deployment runner is missing from the committed archive." }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($runnerEntry, $releaseRunner)
} finally { $zip.Dispose() }

$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$runnerHash = (Get-FileHash -LiteralPath $releaseRunner -Algorithm SHA256).Hash.ToLowerInvariant()
$remoteArchive = "/tmp/$bundleName.zip"
$remoteRunner = "/tmp/$bundleName.sh"
Write-Host "Source commit: $sourceCommit"
Write-Host "Archive SHA-256: $archiveHash"
if ($PrepareOnly) {
    Write-Host "PREPARED_ONLY archive=$archive runner=$releaseRunner; server was not contacted or changed."
    return
}
Invoke-Checked -Program "scp" -Arguments @("-o", "BatchMode=yes", $archive, "${Server}:$remoteArchive")
Invoke-Checked -Program "scp" -Arguments @("-o", "BatchMode=yes", $releaseRunner, "${Server}:$remoteRunner")
$remoteCommand = "cd /tmp && test `"`$(sha256sum $remoteArchive | cut -d' ' -f1)`" = $archiveHash && test `"`$(sha256sum $remoteRunner | cut -d' ' -f1)`" = $runnerHash && sudo -n bash $remoteRunner $remoteArchive $sourceCommit"
Invoke-Checked -Program "ssh" -Arguments @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10", $Server, $remoteCommand)
Write-Host "Deployment checks passed. Open https://jubencn.onesay.top/studio/scripts/new or /studio/novels/new."
