$ErrorActionPreference = "Stop"

$containerName = "supabase_db_dms"
$expectedProject = "dms"
$expectedPort = "54322"

$labels = docker inspect $containerName --format '{{json .Config.Labels}}'
if ($LASTEXITCODE -ne 0) {
  throw "The local Supabase database container is not running."
}

$labelData = $labels | ConvertFrom-Json
if ($labelData.'com.supabase.cli.project' -ne $expectedProject) {
  throw "Refusing to reset an unexpected Docker database container."
}

$port = docker port $containerName 5432
if ($LASTEXITCODE -ne 0 -or $port -notmatch ":$expectedPort$") {
  throw "Refusing to reset a database that is not the local Supabase port."
}

function Invoke-LocalSqlFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  Get-Content -LiteralPath $resolved -Raw |
    docker exec -i $containerName psql `
      --username postgres `
      --dbname postgres `
      --set ON_ERROR_STOP=1

  if ($LASTEXITCODE -ne 0) {
    throw "Local SQL failed: $resolved"
  }
}

Invoke-LocalSqlFile "supabase/tests/fixtures/capdent_v21_minimal_schema.sql"
Invoke-LocalSqlFile "supabase/migrations/20260726204205_capdent_v21_payment_notifications.sql"
Invoke-LocalSqlFile "supabase/migrations/20260726205851_capdent_v21_dental_chart_atomic_visit.sql"

npx supabase db lint --local --schema public --level error --fail-on error
if ($LASTEXITCODE -ne 0) {
  throw "Local Supabase schema lint failed."
}

npx supabase test db --local `
  supabase/tests/database/capdent_v21_payment_notifications_test.sql `
  supabase/tests/database/capdent_v21_dental_chart_atomic_visit_test.sql
if ($LASTEXITCODE -ne 0) {
  throw "CapDent v21 database tests failed."
}

Write-Output "CapDent v21 local Supabase migrations and 45 pgTAP assertions passed."
