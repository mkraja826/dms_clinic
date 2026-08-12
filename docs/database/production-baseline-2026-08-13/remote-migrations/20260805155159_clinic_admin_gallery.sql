begin;

alter table public.files
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists files_clinic_archived_created_idx
  on public.files (clinic_id, archived_at, created_at desc);

create table if not exists public.file_audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  file_id uuid references public.files(id) on delete set null,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('archive', 'restore')),
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists file_audit_logs_clinic_created_idx on public.file_audit_logs (clinic_id, created_at desc);
create index if not exists file_audit_logs_file_created_idx on public.file_audit_logs (file_id, created_at desc);
create index if not exists file_audit_logs_patient_created_idx on public.file_audit_logs (patient_id, created_at desc);

alter table public.file_audit_logs enable row level security;
drop policy if exists file_audit_logs_select_same_clinic on public.file_audit_logs;
create policy file_audit_logs_select_same_clinic on public.file_audit_logs for select to authenticated using (clinic_id = public.current_user_clinic_id());
revoke all on table public.file_audit_logs from anon;
revoke insert, update, delete on table public.file_audit_logs from authenticated;
grant select on table public.file_audit_logs to authenticated;

create or replace function public.protect_file_archive_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.archived_at is distinct from new.archived_at or old.archived_by is distinct from new.archived_by or old.archive_reason is distinct from new.archive_reason)
     and coalesce(current_setting('capdent.file_archive_rpc', true), '') <> 'on' then
    raise exception using errcode = '42501', message = 'Use the audited Clinic Admin file archive operation';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_file_archive_fields() from public, anon, authenticated;
drop trigger if exists files_protect_archive_fields on public.files;
create trigger files_protect_archive_fields before update of archived_at, archived_by, archive_reason on public.files for each row execute function public.protect_file_archive_fields();

create or replace function public.admin_set_file_archived(p_file_id uuid, p_archived boolean, p_reason text)
returns public.files language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor public.profiles;
  v_file public.files;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into v_actor from public.profiles where id = auth.uid() and active = true limit 1;
  if v_actor.id is null or v_actor.clinic_id is null then raise exception using errcode = '42501', message = 'Active clinic profile not found'; end if;
  if v_actor.role not in ('owner', 'head_doctor') then raise exception using errcode = '42501', message = 'Only the clinic owner or head doctor can archive gallery files'; end if;
  if char_length(v_reason) < 3 then raise exception 'A reason of at least 3 characters is required'; end if;
  select * into v_file from public.files where id = p_file_id and clinic_id = v_actor.clinic_id for update;
  if v_file.id is null then raise exception 'Gallery file not found in the active clinic'; end if;
  if (p_archived and v_file.archived_at is not null) or (not p_archived and v_file.archived_at is null) then return v_file; end if;
  perform set_config('capdent.file_archive_rpc', 'on', true);
  update public.files set archived_at = case when p_archived then now() else null end, archived_by = case when p_archived then v_actor.id else null end, archive_reason = case when p_archived then v_reason else null end where id = v_file.id returning * into v_file;
  insert into public.file_audit_logs (clinic_id, patient_id, file_id, changed_by, action, old_value, new_value, reason)
  values (v_actor.clinic_id, v_file.patient_id, v_file.id, v_actor.id, case when p_archived then 'archive' else 'restore' end, jsonb_build_object('archived', not p_archived), jsonb_build_object('archived', p_archived), v_reason);
  return v_file;
end;
$$;
revoke all on function public.admin_set_file_archived(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_file_archived(uuid, boolean, text) to authenticated, service_role;

commit;
