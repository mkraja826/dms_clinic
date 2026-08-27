-- CapDent V27 PhonePe environment isolation.
-- Prevents sandbox merchant orders from ever being reconciled against production PhonePe APIs.

alter table public.phonepe_payment_orders
  add column if not exists environment text;

update public.phonepe_payment_orders
set environment = 'sandbox'
where environment is null or btrim(environment) = '';

alter table public.phonepe_payment_orders
  alter column environment set default 'sandbox';

alter table public.phonepe_payment_orders
  alter column environment set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'phonepe_payment_orders_environment_check'
      and conrelid = 'public.phonepe_payment_orders'::regclass
  ) then
    alter table public.phonepe_payment_orders
      add constraint phonepe_payment_orders_environment_check
      check (environment in ('sandbox', 'production'));
  end if;
end;
$$;

create index if not exists phonepe_payment_orders_environment_created_idx
  on public.phonepe_payment_orders (environment, created_at desc);
