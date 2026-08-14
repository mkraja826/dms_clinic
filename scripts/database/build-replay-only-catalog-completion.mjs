import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const baselineDirectory = resolve(
  repositoryRoot,
  'docs',
  'database',
  'production-baseline-2026-08-13',
);

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith('--')) {
    throw new Error(`Unexpected positional argument: ${argument}`);
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argument}`);
  }

  argumentsByName.set(argument, value);
  index += 1;
}

const workspaceArgument = argumentsByName.get('--workspace');
if (!workspaceArgument || argumentsByName.size !== 1) {
  throw new Error(
    'Usage: node scripts/database/build-replay-only-catalog-completion.mjs --workspace <disposable-replay-directory>',
  );
}

const isInside = (parent, child) => {
  const candidate = relative(parent, child);
  return (
    candidate === '' ||
    (!candidate.startsWith(`..${sep}`) && candidate !== '..' && !isAbsolute(candidate))
  );
};

const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
const requestedWorkspace = resolve(process.cwd(), workspaceArgument);
if (!existsSync(requestedWorkspace) || !lstatSync(requestedWorkspace).isDirectory()) {
  throw new Error('The disposable replay workspace must already exist as a directory.');
}
if (lstatSync(requestedWorkspace).isSymbolicLink()) {
  throw new Error('The disposable replay workspace must not be a symbolic link or junction.');
}

const canonicalWorkspace = realpathSync.native(requestedWorkspace);
if (
  isInside(canonicalRepositoryRoot, canonicalWorkspace) ||
  !basename(canonicalWorkspace).startsWith('capdent-v25-replay-')
) {
  throw new Error(
    'The workspace must be outside the repository and named capdent-v25-replay-*.',
  );
}

const configPath = resolve(canonicalWorkspace, 'supabase', 'config.toml');
const outputDirectory = resolve(canonicalWorkspace, 'supabase', 'migrations');
if (!existsSync(configPath) || !existsSync(outputDirectory)) {
  throw new Error('The workspace must contain supabase/config.toml and supabase/migrations.');
}
if (lstatSync(outputDirectory).isSymbolicLink()) {
  throw new Error('The disposable migration directory must not be a symbolic link or junction.');
}

const canonicalOutputDirectory = realpathSync.native(outputDirectory);
if (
  !isInside(canonicalWorkspace, canonicalOutputDirectory) ||
  isInside(canonicalRepositoryRoot, canonicalOutputDirectory)
) {
  throw new Error('The canonical migration directory escaped the disposable workspace.');
}

const config = readFileSync(configPath, 'utf8');
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projectId?.startsWith('capdent-v25-replay-')) {
  throw new Error('The Supabase local project_id must be capdent-v25-replay-*.');
}
if (existsSync(resolve(canonicalWorkspace, 'supabase', '.temp', 'project-ref'))) {
  throw new Error('Refusing a Supabase workspace with linked-project state.');
}

const outputPath = resolve(
  canonicalOutputDirectory,
  '99999999999999_replay_only_catalog_completion.sql',
);

const readJson = (relativePath) => {
  const absolutePath = resolve(baselineDirectory, relativePath);
  return {
    absolutePath,
    bytes: readFileSync(absolutePath),
    value: JSON.parse(readFileSync(absolutePath, 'utf8')),
  };
};

const manifest = readJson('manifest.json').value;
const functionsCatalog = readJson('catalog/functions.json');
const constraintsIndexesCatalog = readJson('catalog/constraints-indexes.json');
const policiesGrantsCatalog = readJson('catalog/policies-grants.json');

if (manifest.project_ref !== 'mzjtdcpbvoximdukpukd') {
  throw new Error('Unexpected production baseline project reference.');
}
if (manifest.artifact_type !== 'capture-only-production-database-baseline') {
  throw new Error('Unexpected production baseline artifact type.');
}
if (functionsCatalog.value.functions.length !== 94) {
  throw new Error('Expected exactly 94 captured public functions.');
}

const missingIndexNames = [
  'appointments_reminder_idx',
  'appointments_status_idx',
  'clinic_subscriptions_clinic_idx',
  'files_file_type_idx',
  'files_patient_created_idx',
  'files_patient_idx',
  'google_play_subscription_events_clinic_idx',
  'google_play_subscription_events_token_idx',
  'invoices_category_created_idx',
  'invoices_clinic_due_idx',
  'invoices_patient_due_idx',
  'invoices_patient_idx',
  'medication_catalog_clinic_usage_idx',
  'patient_audit_logs_patient_idx',
  'patient_medications_clinic_created_idx',
  'patient_medications_patient_created_idx',
  'patient_visits_patient_idx',
  'patients_clinic_id_idx',
  'patients_name_idx',
  'patients_phone_idx',
  'patients_photo_url_idx',
  'patients_search_idx',
  'payments_category_created_idx',
  'payments_invoice_idx',
  'payments_patient_created_idx',
  'profiles_clinic_id_idx',
  'staff_invites_clinic_idx',
  'staff_invites_code_idx',
  'staff_invites_email_idx',
  'staff_invites_invite_code_idx',
  'treatments_patient_idx',
];

const replacedIndexNames = ['appointments_clinic_time_idx'];

const functionDefinitionsToRestore = new Set([
  'accept_staff_invite(code text)',
  'apply_dms_clinic_isolation_policy(p_table_name text, p_clinic_column text)',
  'can_manage(resource text)',
  'collect_consultation_fee(p_patient_id uuid, p_amount numeric, p_payment_method text, p_notes text)',
  'collect_reception_fee(p_patient_id uuid, p_fee_type text, p_amount numeric, p_payment_method text, p_notes text)',
  'create_patient_followup_reminder(p_patient_id uuid, p_appointment_time timestamp with time zone, p_notes text)',
  'create_staff_invite(invitee_name text, invitee_email text, invitee_role text)',
  'current_clinic_id()',
  'current_profile()',
  'current_profile_clinic_id()',
  'current_profile_role()',
  'current_role()',
  'current_user_is_head_doctor()',
  'delete_patient_file(p_file_id uuid)',
  'generate_invite_code()',
  'get_clinic_waiting_patients()',
  'get_doctor_waiting_queue()',
  'get_followup_reminders(p_filter text, p_search text)',
  'get_patient_pending_invoices(p_patient_id uuid)',
  'get_pending_payment_patients(p_search text)',
  'get_reminder_summary()',
  'get_revenue_summary()',
  'mark_patient_visit_completed(p_patient_id uuid)',
  'owner_update_staff_access(p_staff_id uuid, p_staff_role text, p_staff_active boolean)',
  'record_patient_payment(p_patient_id uuid, p_invoice_id uuid, p_amount numeric, p_payment_method text, p_notes text)',
  'record_patient_payment(p_patient_id uuid, p_invoice_id uuid, p_amount numeric, p_payment_method text, p_notes text, p_payment_category text)',
  'rls_auto_enable()',
  'update_followup_status(p_appointment_id uuid, p_status text)',
  'upsert_patient_medical_history(p_patient_id uuid, p_heart_issue boolean, p_kidney_issue boolean, p_brain_issue boolean, p_diabetes boolean, p_blood_pressure boolean, p_allergies text, p_current_medicines text, p_other_notes text)',
]);

const missingPolicyKeys = new Set([
  'public.charges.charges_all_own_clinic',
  'public.charges.dms_clinic_isolation_charges',
  'public.patient_medications.clinic members insert patient medications',
  'public.patient_medications.clinic members read patient medications',
  'public.patient_medications.dms_clinic_isolation_patient_medications',
  'public.website_appointments.Authenticated staff can view appointments',
  'storage.objects.clinic_logos_delete_own_clinic',
  'storage.objects.clinic_logos_insert_own_clinic',
  'storage.objects.clinic_logos_update_own_clinic',
]);

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const terminate = (statement) => `${statement.trimEnd().replace(/;$/, '')};`;
const functionKey = (entry) => `${entry.name}(${entry.identity_arguments})`;
const policyKey = (entry) => `${entry.schema}.${entry.table}.${entry.name}`;

const capturedIndexes = new Map(
  constraintsIndexesCatalog.value.indexes
    .filter((entry) => entry.schema === 'public')
    .map((entry) => [entry.name, entry]),
);
for (const name of [...missingIndexNames, ...replacedIndexNames]) {
  if (!capturedIndexes.has(name)) {
    throw new Error(`Captured production index is missing: ${name}`);
  }
}

const capturedFunctions = new Map(
  functionsCatalog.value.functions.map((entry) => [functionKey(entry), entry]),
);
for (const key of functionDefinitionsToRestore) {
  if (!capturedFunctions.has(key)) {
    throw new Error(`Captured production function is missing: ${key}`);
  }
}
if (functionDefinitionsToRestore.size !== 29) {
  throw new Error('Expected exactly 29 missing or bootstrap-drifted function definitions.');
}
if (functionsCatalog.value.functions.some((entry) => !entry.service_role_execute)) {
  throw new Error('Expected every captured public function to be executable by service_role.');
}

const capturedPolicies = new Map(
  policiesGrantsCatalog.value.policies.map((entry) => [policyKey(entry), entry]),
);
for (const key of missingPolicyKeys) {
  if (!capturedPolicies.has(key)) {
    throw new Error(`Captured production policy is missing: ${key}`);
  }
}
if (missingPolicyKeys.size !== 9) {
  throw new Error('Expected exactly nine out-of-ledger production policies.');
}

const sourceHash = createHash('sha256')
  .update(functionsCatalog.bytes)
  .update(constraintsIndexesCatalog.bytes)
  .update(policiesGrantsCatalog.bytes)
  .digest('hex');

const output = [];
const emit = (...lines) => output.push(...lines);

emit(
  '-- CAPDENT V25 DISPOSABLE REPLAY ONLY.',
  '-- This is generated recovery evidence, not an application or production migration.',
  '-- Never copy this file into C:/dms/supabase/migrations and never apply it to production.',
  `-- Captured project: ${manifest.project_ref}`,
  `-- Catalog source digest: ${sourceHash}`,
  '',
  'do $capdent_replay_guard$',
  'begin',
  '  if not exists (',
  '    select 1 from pg_catalog.pg_roles',
  "    where rolname = 'capdent_v25_replay_sentinel'",
  '      and rolcanlogin = false',
  '      and rolinherit = false',
  '  ) then',
  "    raise exception 'CapDent replay sentinel is missing; refusing catalog completion.';",
  '  end if;',
  'end',
  '$capdent_replay_guard$;',
  '',
  'begin;',
  '',
  '-- Restore application indexes that exist in production outside the 73-entry ledger.',
);

for (const name of replacedIndexNames) {
  emit(`drop index if exists public.${quoteIdentifier(name)};`);
}
for (const name of [...replacedIndexNames, ...missingIndexNames]) {
  emit(terminate(capturedIndexes.get(name).definition));
}

emit(
  '',
  '-- Restore missing and synthesized-bootstrap function definitions exactly from capture.',
);
for (const entry of functionsCatalog.value.functions) {
  if (functionDefinitionsToRestore.has(functionKey(entry))) {
    emit(terminate(entry.definition), '');
  }
}

emit(
  '-- Match final production function exposure without changing any function body not listed above.',
  'grant execute on all functions in schema public to service_role;',
  'revoke execute on function public.accept_staff_invite_by_code(text) from public, anon;',
);
for (const entry of functionsCatalog.value.functions) {
  if (!functionDefinitionsToRestore.has(functionKey(entry))) {
    continue;
  }

  const signature = `public.${quoteIdentifier(entry.name)}(${entry.identity_arguments})`;
  const roles = ['postgres'];
  if (entry.authenticated_execute) {
    roles.push('authenticated');
  }
  roles.push('service_role');
  if (entry.anon_execute) {
    roles.push('public');
  }
  emit(
    `revoke execute on function ${signature} from public, anon, authenticated, service_role;`,
    `grant execute on function ${signature} to ${roles.join(', ')};`,
  );
}

emit('', '-- Restore the nine final-state policies absent from the ledger.');
for (const entry of policiesGrantsCatalog.value.policies) {
  if (!missingPolicyKeys.has(policyKey(entry))) {
    continue;
  }

  const qualifiedTable = `${quoteIdentifier(entry.schema)}.${quoteIdentifier(entry.table)}`;
  emit(`drop policy if exists ${quoteIdentifier(entry.name)} on ${qualifiedTable};`);
  const clauses = [
    `create policy ${quoteIdentifier(entry.name)} on ${qualifiedTable}`,
    `as ${entry.permissive.toLowerCase()}`,
    `for ${entry.command.toLowerCase()}`,
    `to ${entry.roles.map(quoteIdentifier).join(', ')}`,
  ];
  if (entry.using !== null) {
    clauses.push(`using (${entry.using})`);
  }
  if (entry.with_check !== null) {
    clauses.push(`with check (${entry.with_check})`);
  }
  emit(`${clauses.join('\n  ')};`);
}

emit('', '-- Restore captured public table privileges; GRANT is idempotent.');
const tableGrantGroups = new Map();
for (const grant of policiesGrantsCatalog.value.table_grants) {
  if (grant.schema !== 'public') {
    continue;
  }
  const key = `${grant.grantee}\u0000${grant.schema}\u0000${grant.table}`;
  const group = tableGrantGroups.get(key) ?? {
    grantee: grant.grantee,
    schema: grant.schema,
    table: grant.table,
    privileges: [],
  };
  group.privileges.push(grant.privilege.toLowerCase());
  tableGrantGroups.set(key, group);
}
for (const group of [...tableGrantGroups.values()].sort((left, right) =>
  `${left.grantee}.${left.table}`.localeCompare(`${right.grantee}.${right.table}`),
)) {
  emit(
    `grant ${group.privileges.sort().join(', ')} on table ${quoteIdentifier(group.schema)}.${quoteIdentifier(group.table)} to ${quoteIdentifier(group.grantee)};`,
  );
}

emit(
  '',
  '-- Restore the current sequence ACL and legacy production default privileges.',
  'grant all privileges on sequence public.capdent_pricing_shadow_events_id_seq to anon, authenticated, service_role;',
  'alter default privileges for role postgres in schema public grant all privileges on sequences to anon, authenticated, service_role;',
  'alter default privileges for role postgres in schema public grant execute on functions to service_role;',
  'alter default privileges for role postgres in schema public grant all privileges on tables to anon, authenticated, service_role;',
  '',
  'commit;',
  '',
);

writeFileSync(outputPath, output.join('\n'), { encoding: 'utf8', flag: 'wx' });
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      output: outputPath,
      sourceHash,
      restoredIndexes: missingIndexNames.length + replacedIndexNames.length,
      restoredFunctionDefinitions: functionDefinitionsToRestore.size,
      restoredPolicies: missingPolicyKeys.size,
      productionTableGrantRowsEncoded: policiesGrantsCatalog.value.table_grants.filter(
        (entry) => entry.schema === 'public',
      ).length,
    },
    null,
    2,
  ),
);
