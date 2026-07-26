-- Additive performance indexes for existing CapDent clinic workflows.
-- These indexes do not change data, permissions, or application behaviour.

create index if not exists patients_clinic_created_idx
  on public.patients (clinic_id, created_at desc);

create index if not exists patient_visits_followup_idx
  on public.patient_visits (clinic_id, next_appointment_date)
  where next_appointment_date is not null;

create index if not exists treatments_clinic_status_created_idx
  on public.treatments (clinic_id, status, created_at desc);

create index if not exists patient_audit_logs_clinic_created_idx
  on public.patient_audit_logs (clinic_id, created_at desc);

create index if not exists appointments_waived_op_idx
  on public.appointments (clinic_id, created_at desc)
  where op_fee_status = 'waived';

create index if not exists invoices_open_due_idx
  on public.invoices (clinic_id, due_amount desc)
  where due_amount > 0 and status in ('unpaid', 'partial');
