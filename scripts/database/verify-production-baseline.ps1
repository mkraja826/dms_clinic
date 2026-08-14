[CmdletBinding()]
param(
  [string]$BaselinePath
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BaselinePath)) {
  $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $BaselinePath = Join-Path $repositoryRoot 'docs\database\production-baseline-2026-08-13'
}

$baseline = (Resolve-Path -LiteralPath $BaselinePath).Path
$normalizedBaseline = $baseline.Replace('\', '/').ToLowerInvariant()
if ($normalizedBaseline.Contains('/supabase/migrations/')) {
  throw 'The capture-only baseline must never live under supabase/migrations.'
}

function Get-Utf8Md5([string]$Value) {
  $algorithm = [System.Security.Cryptography.MD5]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ([System.BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $algorithm.Dispose()
  }
}

$manifestPath = Join-Path $baseline 'manifest.json'
$ledgerPath = Join-Path $baseline 'migration-ledger.json'
$hashManifestPath = Join-Path $baseline 'hashes.sha256'
$ownershipPath = Join-Path $baseline 'ownership.json'

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$ledger = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
$ownership = Get-Content -LiteralPath $ownershipPath -Raw | ConvertFrom-Json

if ($manifest.artifact_type -ne 'capture-only-production-database-baseline') {
  throw 'Unexpected baseline artifact type.'
}
if ($manifest.project_ref -ne 'mzjtdcpbvoximdukpukd') {
  throw 'Unexpected production project reference.'
}
if ($manifest.replay_ready -eq $true) {
  $requiredClosureEvidence = @(
    (Join-Path $baseline 'backup-pitr-evidence.md'),
    (Join-Path $baseline 'replay\reconciliation-result.md')
  )

  foreach ($evidencePath in $requiredClosureEvidence) {
    if (-not (Test-Path -LiteralPath $evidencePath)) {
      throw "replay_ready=true requires closure evidence: $evidencePath"
    }
  }

  if (@($manifest.replay_blockers).Count -ne 0) {
    throw 'replay_ready=true requires an empty replay_blockers list.'
  }
}
elseif ($manifest.replay_ready -ne $false) {
  throw 'Manifest replay_ready must be explicitly true or false.'
}
if ([int]$ledger.migration_count -ne [int]$manifest.migration_count) {
  throw 'Manifest and migration-ledger counts disagree.'
}

$migrationDirectory = Join-Path $baseline 'remote-migrations'
$migrationFiles = @(Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.sql')
if ($migrationFiles.Count -ne [int]$ledger.migration_count) {
  throw "Expected $($ledger.migration_count) migration snapshots, found $($migrationFiles.Count)."
}

$migrationFailures = [System.Collections.Generic.List[string]]::new()
foreach ($migration in $ledger.migrations) {
  $fileName = '{0}_{1}.sql' -f $migration.version, $migration.name
  $filePath = Join-Path $migrationDirectory $fileName
  if (-not (Test-Path -LiteralPath $filePath)) {
    $migrationFailures.Add("Missing $fileName")
    continue
  }

  $contents = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $filePath))
  $actualMd5 = Get-Utf8Md5 $contents
  if ($actualMd5 -ne $migration.snapshot_file_md5) {
    $migrationFailures.Add("MD5 mismatch for $fileName")
  }
}
if ($migrationFailures.Count -gt 0) {
  throw ($migrationFailures -join [Environment]::NewLine)
}

$hashFailures = [System.Collections.Generic.List[string]]::new()
$listedPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($line in Get-Content -LiteralPath $hashManifestPath) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') {
    continue
  }

  $expectedHash = $Matches[1]
  $relativePath = $Matches[2]
  [void]$listedPaths.Add($relativePath)
  $filePath = Join-Path $baseline $relativePath.Replace('/', '\')
  if (-not (Test-Path -LiteralPath $filePath)) {
    $hashFailures.Add("Missing hash target $relativePath")
    continue
  }

  $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    $hashFailures.Add("SHA-256 mismatch for $relativePath")
  }
}

$unlistedFiles = @(
  Get-ChildItem -LiteralPath $baseline -Recurse -File |
    Where-Object { $_.FullName -ne $hashManifestPath } |
    ForEach-Object { $_.FullName.Substring($baseline.Length + 1).Replace('\', '/') } |
    Where-Object { -not $listedPaths.Contains($_) }
)
foreach ($unlisted in $unlistedFiles) {
  $hashFailures.Add("Unlisted artifact $unlisted")
}
if ($hashFailures.Count -gt 0) {
  throw ($hashFailures -join [Environment]::NewLine)
}

$credentialPatterns = @(
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}',
  'sb_secret_[A-Za-z0-9_-]{10,}',
  'sk-[A-Za-z0-9_-]{16,}',
  'AKIA[0-9A-Z]{16}',
  'AIza[0-9A-Za-z_-]{20,}',
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
  'postgres(ql)?://[^\s]+:[^\s]+@',
  'Bearer\s+[A-Za-z0-9._-]{16,}'
)
$credentialHits = [System.Collections.Generic.List[string]]::new()
foreach ($file in Get-ChildItem -LiteralPath $baseline -Recurse -File) {
  $contents = Get-Content -LiteralPath $file.FullName -Raw
  foreach ($pattern in $credentialPatterns) {
    if ($contents -match $pattern) {
      $credentialHits.Add($file.FullName.Substring($baseline.Length + 1))
      break
    }
  }
}
if ($credentialHits.Count -gt 0) {
  throw "Possible credential material found in: $($credentialHits -join ', ')"
}

$portalRange = $ownership.owner_web_portal.migration_range
$portalMigrations = @(
  $ledger.migrations | Where-Object {
    $_.version -ge $portalRange.first -and $_.version -le $portalRange.last
  }
)
if ($portalMigrations.Count -ne [int]$portalRange.count) {
  throw 'Portal migration ownership range is incomplete.'
}

[pscustomobject]@{
  Status = 'PASS'
  Project = $manifest.project_ref
  Migrations = $migrationFiles.Count
  HashManifestEntries = $listedPaths.Count
  CredentialPatternHits = $credentialHits.Count
  PortalOwnedMigrations = $portalMigrations.Count
  ReplayReady = [bool]$manifest.replay_ready
}
