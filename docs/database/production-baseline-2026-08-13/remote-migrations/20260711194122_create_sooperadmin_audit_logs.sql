create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null,
  actor_email text not null,
  action text not null,
  target_type text not null,
  target_id text null,
  clinic_id uuid null references public.clinics(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_clinic_id_idx
  on public.admin_audit_logs (clinic_id, created_at desc);

alter table public.admin_audit_logs enable row level security;

comment on table public.admin_audit_logs is 'Server-side SooperAdmin mutation audit trail. Service-role access only.';
