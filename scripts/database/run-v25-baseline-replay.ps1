[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Workspace
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$baseline = Join-Path $repositoryRoot 'docs\database\production-baseline-2026-08-13'
$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path

function Test-PathInside([string]$Parent, [string]$Child) {
  $normalizedParent = $Parent.TrimEnd('\') + '\'
  return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or
    $Child.StartsWith($normalizedParent, [StringComparison]::OrdinalIgnoreCase)
}

if (Test-PathInside $repositoryRoot $workspacePath) {
  throw 'The disposable replay workspace must be outside the repository.'
}
if ((Split-Path -Leaf $workspacePath) -notlike 'capdent-v25-replay-*') {
  throw 'The disposable workspace name must start with capdent-v25-replay-.'
}

$supabaseDirectory = Join-Path $workspacePath 'supabase'
$configPath = Join-Path $supabaseDirectory 'config.toml'
$migrationDirectory = Join-Path $supabaseDirectory 'migrations'
foreach ($path in @($workspacePath, $supabaseDirectory, $migrationDirectory)) {
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Replay path must not be a symbolic link or junction: $path"
  }
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw 'Run supabase init in the disposable workspace before replay.'
}
if (Test-Path -LiteralPath (Join-Path $supabaseDirectory '.temp\project-ref')) {
  throw 'Refusing a Supabase workspace that contains linked-project state.'
}

$config = Get-Content -LiteralPath $configPath -Raw
if ($config -notmatch '(?m)^project_id\s*=\s*"(capdent-v25-replay-[^"]+)"') {
  throw 'The local Supabase project_id must start with capdent-v25-replay-.'
}
$projectId = $Matches[1]
if ($config -notmatch '(?m)^major_version\s*=\s*17\s*$') {
  throw 'The disposable replay must use PostgreSQL major version 17.'
}

$existingMigrations = @(Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.sql')
if ($existingMigrations.Count -ne 0) {
  throw 'The guarded runner requires an empty disposable migration directory.'
}

Push-Location $workspacePath
try {
  & supabase start --exclude 'studio,imgproxy,mailpit,edge-runtime,logflare,vector'
  if ($LASTEXITCODE -ne 0) {
    throw "supabase start failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

$rolesPath = Join-Path $supabaseDirectory 'roles.sql'
if (Test-Path -LiteralPath $rolesPath) {
  throw 'The guarded runner requires no pre-existing supabase/roles.sql file.'
}

# `supabase db reset` recreates database roles before applying migrations. Put
# a uniquely named, inert NOLOGIN role in the disposable workspace's globals
# seed so every reset reinstalls it immediately before the replay-only
# bootstrap guard executes. Custom roles are the supported roles.sql use case.
$sentinelRoleSql = @"
create role capdent_v25_replay_sentinel nologin noinherit;
"@
[IO.File]::WriteAllText(
  $rolesPath,
  $sentinelRoleSql,
  [Text.UTF8Encoding]::new($false)
)

$ledger = Get-Content -LiteralPath (Join-Path $baseline 'migration-ledger.json') -Raw |
  ConvertFrom-Json
if ([int]$ledger.migration_count -ne 73) {
  throw 'Expected exactly 73 production ledger identities.'
}

$bootstrapDestination = Join-Path $migrationDirectory '00000000000000_pre_ledger_bootstrap.sql'
Copy-Item -LiteralPath (Join-Path $baseline 'replay\pre-ledger-bootstrap.sql') `
  -Destination $bootstrapDestination

foreach ($migration in $ledger.migrations) {
  $fileName = '{0}_{1}.sql' -f $migration.version, $migration.name
  $destination = Join-Path $migrationDirectory $fileName

  if ($migration.version -eq '20260727012628') {
    $source = Join-Path $repositoryRoot 'supabase\migrations\20260727012628_activate_capdent_v22_features.sql'
    $expectedHash = '978DA4FF0FB6B6E9C860CD025C5F4E9B886195851CBFC4FF2AEC3D0AECA8D85B'
    $actualHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
      throw 'The approved replay-only 20260727012628 serialization repair changed.'
    }
  }
  else {
    $source = Join-Path $baseline "remote-migrations\$fileName"
  }

  Copy-Item -LiteralPath $source -Destination $destination
}

& node (Join-Path $repositoryRoot 'scripts\database\build-replay-only-catalog-completion.mjs') `
  --workspace $workspacePath
if ($LASTEXITCODE -ne 0) {
  throw 'Replay-only catalog completion generation failed.'
}

$stagedMigrations = @(Get-ChildItem -LiteralPath $migrationDirectory -File -Filter '*.sql')
if ($stagedMigrations.Count -ne 75) {
  throw "Expected 75 replay rows (2 synthetic + 73 ledger identities), found $($stagedMigrations.Count)."
}

$evidenceDirectory = Join-Path $workspacePath 'evidence\guarded-final'
New-Item -ItemType Directory -Path $evidenceDirectory -ErrorAction Stop | Out-Null
$passResults = @()

for ($pass = 1; $pass -le 2; $pass += 1) {
  $passDirectory = Join-Path $evidenceDirectory "pass-$pass"
  New-Item -ItemType Directory -Path $passDirectory -ErrorAction Stop | Out-Null
  $logPath = Join-Path $passDirectory 'reset.log'

  Push-Location $workspacePath
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & supabase db reset --local --no-seed --yes 2>&1 |
        Tee-Object -LiteralPath $logPath
      $resetExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($resetExitCode -ne 0) {
      throw "Disposable reset pass $pass failed with exit code $resetExitCode."
    }

    foreach ($schema in @('public', 'auth', 'storage')) {
      & supabase db dump --local --schema $schema `
        --file (Join-Path $passDirectory "$schema-schema.sql")
      if ($LASTEXITCODE -ne 0) {
        throw "Schema dump failed for $schema on pass $pass."
      }
    }
  }
  finally {
    Pop-Location
  }

  $hashes = @{}
  foreach ($schema in @('public', 'auth', 'storage')) {
    $hashes[$schema] = (Get-FileHash `
      -LiteralPath (Join-Path $passDirectory "$schema-schema.sql") `
      -Algorithm SHA256).Hash
  }
  $passResults += [pscustomobject]@{ pass = $pass; schema_sha256 = $hashes }
}

$deterministic = $true
foreach ($schema in @('public', 'auth', 'storage')) {
  if ($passResults[0].schema_sha256[$schema] -ne $passResults[1].schema_sha256[$schema]) {
    $deterministic = $false
  }
}
if (-not $deterministic) {
  throw 'The two final replay schema dumps are not deterministic.'
}

$result = [ordered]@{
  status = 'PASS'
  project_id = $projectId
  production_ledger_identities = 73
  captured_bodies = 72
  serialization_repairs = @('20260727012628')
  synthetic_recovery_rows = 2
  total_local_migration_rows = 75
  deterministic = $deterministic
  passes = $passResults
}
$resultPath = Join-Path $evidenceDirectory 'replay-result.json'
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding utf8
$result
