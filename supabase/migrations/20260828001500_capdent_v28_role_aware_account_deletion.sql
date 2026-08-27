-- CapDent V28 role-aware account deletion support.
-- Owner/head-doctor: clinic + associated CapDent accounts.
-- Other staff: only their auth/profile identity; clinic-owned records remain.

create table if not exists public.capdent_account_deletion_queue (
  clinic_id uuid not null,
  user_id uuid not null,
  queued_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

alter table public.capdent_account_deletion_queue enable row level security;
revoke all on public.capdent_account_deletion_queue from anon, authenticated;
grant all on public.capdent_account_deletion_queue to service_role;

-- Staff deletion must not be blocked by historical attribution FKs. Historical
-- clinic rows remain, but their actor columns become NULL after profile removal.
alter table public.consolidated_bills drop constraint if exists consolidated_bills_finalized_by_fkey;
alter table public.consolidated_bills
  add constraint consolidated_bills_finalized_by_fkey foreign key (finalized_by) references public.profiles(id) on delete set null;

alter table public.consolidated_bills drop constraint if exists consolidated_bills_voided_by_fkey;
alter table public.consolidated_bills
  add constraint consolidated_bills_voided_by_fkey foreign key (voided_by) references public.profiles(id) on delete set null;

alter table public.patient_payment_requests drop constraint if exists patient_payment_requests_requested_by_fkey;
alter table public.patient_payment_requests
  add constraint patient_payment_requests_requested_by_fkey foreign key (requested_by) references public.profiles(id) on delete set null;

alter table public.patient_payment_resolution_actions drop constraint if exists patient_payment_resolution_actions_resolved_by_fkey;
alter table public.patient_payment_resolution_actions
  add constraint patient_payment_resolution_actions_resolved_by_fkey foreign key (resolved_by) references public.profiles(id) on delete set null;

alter table public.payments drop constraint if exists payments_collected_by_fkey;
alter table public.payments
  add constraint payments_collected_by_fkey foreign key (collected_by) references public.profiles(id) on delete set null;

-- Clinic deletion has several V28 financial tables intentionally marked
-- RESTRICT during normal operation. For explicit, strongly-confirmed clinic
-- deletion they must be removed before the clinics row can cascade the rest.
create or replace function public.delete_capdent_clinic_for_account_deletion(
  p_clinic_id uuid,
  p_requesting_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_profile_clinic uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select lower(replace(coalesce(role, ''), '-', '_')), clinic_id
    into v_role, v_profile_clinic
  from public.profiles
  where id = p_requesting_user_id
    and active = true;

  if v_profile_clinic is distinct from p_clinic_id or v_role not in ('owner', 'head_doctor') then
    raise exception 'owner or head doctor authority required';
  end if;

  insert into public.capdent_account_deletion_queue (clinic_id, user_id)
  select p_clinic_id, id from public.profiles where clinic_id = p_clinic_id
  on conflict do nothing;

  delete from public.patient_payment_resolution_actions where clinic_id = p_clinic_id;
  delete from public.patient_payment_reconciliation_entries where clinic_id = p_clinic_id;
  delete from public.patient_payment_provider_events where clinic_id = p_clinic_id;
  delete from public.patient_payment_requests where clinic_id = p_clinic_id;
  delete from public.consolidated_bill_items where clinic_id = p_clinic_id;
  delete from public.consolidated_bills where clinic_id = p_clinic_id;

  delete from public.clinics where id = p_clinic_id;
  if not found then raise exception 'clinic not found'; end if;
end;
$$;

revoke all on function public.delete_capdent_clinic_for_account_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_capdent_clinic_for_account_deletion(uuid, uuid) to service_role;

create or replace function public.detach_capdent_staff_profile_for_account_deletion(
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select lower(replace(coalesce(role, ''), '-', '_')) into v_role
  from public.profiles where id = p_user_id;

  if v_role is null then raise exception 'profile not found'; end if;
  if v_role in ('owner', 'head_doctor') then
    raise exception 'clinic authority must use clinic deletion';
  end if;

  delete from public.profiles where id = p_user_id;
end;
$$;

revoke all on function public.detach_capdent_staff_profile_for_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.detach_capdent_staff_profile_for_account_deletion(uuid) to service_role;
