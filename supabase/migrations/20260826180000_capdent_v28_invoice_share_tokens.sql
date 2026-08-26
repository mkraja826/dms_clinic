begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.consolidated_bill_share_tokens (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  bill_id uuid not null references public.consolidated_bills(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists consolidated_bill_share_tokens_bill_idx
  on public.consolidated_bill_share_tokens (bill_id, created_at desc);
create index if not exists consolidated_bill_share_tokens_expiry_idx
  on public.consolidated_bill_share_tokens (expires_at)
  where revoked_at is null;

alter table public.consolidated_bill_share_tokens enable row level security;
revoke all on table public.consolidated_bill_share_tokens from anon, authenticated;

drop function if exists public.create_v28_invoice_share_token(uuid, integer);
create function public.create_v28_invoice_share_token(
  p_bill_id uuid,
  p_ttl_minutes integer default 10080
)
returns table (
  token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_bill public.consolidated_bills%rowtype;
  v_token text;
  v_expires timestamptz;
  v_ttl integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  if v_profile.id is null or v_profile.clinic_id is null then
    raise exception 'Clinic profile not found';
  end if;

  if lower(coalesce(v_profile.role, '')) not in ('owner', 'head_doctor', 'receptionist', 'reception') then
    raise exception 'Only reception or clinic owners can create patient invoice links';
  end if;

  select * into v_bill
  from public.consolidated_bills
  where id = p_bill_id
    and clinic_id = v_profile.clinic_id
    and status = 'finalized';

  if v_bill.id is null then
    raise exception 'Finalized invoice not found in this clinic';
  end if;

  v_ttl := greatest(15, least(coalesce(p_ttl_minutes, 10080), 43200));
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(mins => v_ttl);

  update public.consolidated_bill_share_tokens
  set revoked_at = now()
  where bill_id = v_bill.id
    and revoked_at is null
    and expires_at > now();

  insert into public.consolidated_bill_share_tokens (
    clinic_id,
    bill_id,
    token_hash,
    expires_at,
    created_by
  ) values (
    v_profile.clinic_id,
    v_bill.id,
    encode(digest(v_token, 'sha256'), 'hex'),
    v_expires,
    v_user_id
  );

  return query select v_token, v_expires;
end;
$$;

revoke all on function public.create_v28_invoice_share_token(uuid, integer) from public;
grant execute on function public.create_v28_invoice_share_token(uuid, integer) to authenticated;

drop function if exists public.revoke_v28_invoice_share_tokens(uuid);
create function public.revoke_v28_invoice_share_tokens(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_user_id;

  if v_profile.id is null or v_profile.clinic_id is null then
    raise exception 'Clinic profile not found';
  end if;

  if lower(coalesce(v_profile.role, '')) not in ('owner', 'head_doctor', 'receptionist', 'reception') then
    raise exception 'Only reception or clinic owners can revoke invoice links';
  end if;

  update public.consolidated_bill_share_tokens
  set revoked_at = now()
  where bill_id = p_bill_id
    and clinic_id = v_profile.clinic_id
    and revoked_at is null;
end;
$$;

revoke all on function public.revoke_v28_invoice_share_tokens(uuid) from public;
grant execute on function public.revoke_v28_invoice_share_tokens(uuid) to authenticated;

commit;
