-- CapDent V28 manual clinic QR payment foundation.
-- Keeps QR collection independent from provider checkout/webhooks.
-- Owners/head doctors manage QR accounts; active clinic staff may read them.

begin;

create table if not exists public.clinic_payment_qr_accounts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  label text not null,
  account_name text,
  upi_id text,
  qr_storage_path text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_payment_qr_accounts_label_check
    check (char_length(trim(label)) between 1 and 80),
  constraint clinic_payment_qr_accounts_account_name_check
    check (account_name is null or char_length(trim(account_name)) between 1 and 120),
  constraint clinic_payment_qr_accounts_upi_id_check
    check (upi_id is null or char_length(trim(upi_id)) between 3 and 160),
  constraint clinic_payment_qr_accounts_storage_path_check
    check (char_length(trim(qr_storage_path)) between 3 and 512)
);

create unique index if not exists clinic_payment_qr_accounts_one_default_idx
  on public.clinic_payment_qr_accounts (clinic_id)
  where is_default = true and is_active = true;

create index if not exists clinic_payment_qr_accounts_clinic_active_idx
  on public.clinic_payment_qr_accounts (clinic_id, is_active desc, is_default desc, created_at);

alter table public.clinic_payment_qr_accounts enable row level security;

revoke all on table public.clinic_payment_qr_accounts from public;
grant select, insert, update, delete on table public.clinic_payment_qr_accounts to authenticated;

-- Clinic members can view active QR receiving accounts for collection.
drop policy if exists clinic_payment_qr_accounts_select_clinic on public.clinic_payment_qr_accounts;
create policy clinic_payment_qr_accounts_select_clinic
on public.clinic_payment_qr_accounts
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id = clinic_payment_qr_accounts.clinic_id
  )
);

-- Only owner/head doctor can create QR accounts for their own active clinic.
drop policy if exists clinic_payment_qr_accounts_insert_owner on public.clinic_payment_qr_accounts;
create policy clinic_payment_qr_accounts_insert_owner
on public.clinic_payment_qr_accounts
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id = clinic_payment_qr_accounts.clinic_id
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
  )
);

-- Only owner/head doctor can modify QR accounts in their clinic.
drop policy if exists clinic_payment_qr_accounts_update_owner on public.clinic_payment_qr_accounts;
create policy clinic_payment_qr_accounts_update_owner
on public.clinic_payment_qr_accounts
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id = clinic_payment_qr_accounts.clinic_id
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id = clinic_payment_qr_accounts.clinic_id
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
  )
);

drop policy if exists clinic_payment_qr_accounts_delete_owner on public.clinic_payment_qr_accounts;
create policy clinic_payment_qr_accounts_delete_owner
on public.clinic_payment_qr_accounts
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id = clinic_payment_qr_accounts.clinic_id
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
  )
);

-- Private QR image bucket. Paths must be <clinic_uuid>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-payment-qr',
  'clinic-payment-qr',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Active clinic members can read their clinic's QR images.
drop policy if exists clinic_payment_qr_read_clinic on storage.objects;
create policy clinic_payment_qr_read_clinic
on storage.objects
for select
to authenticated
using (
  bucket_id = 'clinic-payment-qr'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.clinic_id::text = (storage.foldername(name))[1]
  )
);

-- Owners/head doctors can upload QR images only under their clinic folder.
drop policy if exists clinic_payment_qr_insert_owner on storage.objects;
create policy clinic_payment_qr_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'clinic-payment-qr'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
      and p.clinic_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists clinic_payment_qr_update_owner on storage.objects;
create policy clinic_payment_qr_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'clinic-payment-qr'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
      and p.clinic_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'clinic-payment-qr'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
      and p.clinic_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists clinic_payment_qr_delete_owner on storage.objects;
create policy clinic_payment_qr_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'clinic-payment-qr'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and lower(coalesce(p.role, '')) in ('owner', 'head_doctor')
      and p.clinic_id::text = (storage.foldername(name))[1]
  )
);

comment on table public.clinic_payment_qr_accounts is
  'V28 clinic-managed manual payment QR accounts. Displaying a QR never proves or records payment.';
comment on column public.clinic_payment_qr_accounts.qr_storage_path is
  'Private storage object path in clinic-payment-qr bucket. Expected format: <clinic_uuid>/<filename>.';

commit;
