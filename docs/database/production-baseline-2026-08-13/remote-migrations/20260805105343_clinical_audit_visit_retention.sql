alter table public.clinical_audit_logs
  drop constraint if exists clinical_audit_logs_visit_id_fkey;

alter table public.clinical_audit_logs
  add constraint clinical_audit_logs_visit_id_fkey
  foreign key (visit_id)
  references public.patient_visits(id)
  on delete set null;
