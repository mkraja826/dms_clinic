-- CapDent v22 production-wide feature activation.
-- Keep the columns as rollback controls, but make every existing and future
-- clinic active by default for payment push and dental charting.

alter table public.clinics
  alter column payment_push_enabled set default true,
  alter column tooth_chart_enabled set default true;

update public.clinics
set
  payment_push_enabled = true,
  tooth_chart_enabled = true
where payment_push_enabled is distinct from true
   or tooth_chart_enabled is distinct from true;

comment on column public.clinics.payment_push_enabled is
  'CapDent v22 payment push is enabled by default; retained as an emergency clinic-level rollback control.';

comment on column public.clinics.tooth_chart_enabled is
  'CapDent v22 dental charting is enabled by default; retained as an emergency clinic-level rollback control.';
