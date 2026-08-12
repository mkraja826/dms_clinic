create index if not exists appointments_doctor_id_idx on public.appointments(doctor_id);
create index if not exists appointments_patient_id_idx on public.appointments(patient_id);
create index if not exists appointments_clinic_time_idx on public.appointments(clinic_id, appointment_time desc);
create index if not exists appointments_clinic_status_time_idx on public.appointments(clinic_id, status, appointment_time desc);

create index if not exists charges_clinic_id_idx on public.charges(clinic_id);
create index if not exists charges_patient_id_idx on public.charges(patient_id);
create index if not exists charges_visit_id_idx on public.charges(visit_id);

create index if not exists files_uploaded_by_idx on public.files(uploaded_by);
create index if not exists files_visit_id_idx on public.files(visit_id);
create index if not exists files_clinic_created_idx on public.files(clinic_id, created_at desc);

create index if not exists invoices_visit_id_idx on public.invoices(visit_id);
create index if not exists invoices_clinic_status_idx on public.invoices(clinic_id, status);
create index if not exists invoices_clinic_created_idx on public.invoices(clinic_id, created_at desc);

create index if not exists medical_history_clinic_id_idx on public.medical_history(clinic_id);

create index if not exists patient_audit_logs_changed_by_idx on public.patient_audit_logs(changed_by);
create index if not exists patient_audit_logs_clinic_id_idx on public.patient_audit_logs(clinic_id);

create index if not exists patient_visits_clinic_id_idx on public.patient_visits(clinic_id);
create index if not exists patient_visits_doctor_id_idx on public.patient_visits(doctor_id);
create index if not exists patient_visits_clinic_date_idx on public.patient_visits(clinic_id, visit_date desc);

create index if not exists payments_collected_by_idx on public.payments(collected_by);
create index if not exists payments_clinic_created_idx on public.payments(clinic_id, created_at desc);

create index if not exists staff_invites_invited_by_idx on public.staff_invites(invited_by);
create index if not exists staff_invites_clinic_pending_idx on public.staff_invites(clinic_id, accepted_at) where accepted_at is null;

create index if not exists treatments_clinic_id_idx on public.treatments(clinic_id);
create index if not exists treatments_visit_id_idx on public.treatments(visit_id);
