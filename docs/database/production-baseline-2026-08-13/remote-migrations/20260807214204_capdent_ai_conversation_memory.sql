create table if not exists public.capdent_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_key text not null default 'portal',
  last_patient_id uuid null references public.patients(id) on delete set null,
  last_patient_name text null,
  last_topic text null,
  last_date_from timestamptz null,
  last_date_to timestamptz null,
  last_question text null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, conversation_key)
);

alter table public.capdent_ai_conversations enable row level security;

drop policy if exists capdent_ai_conversations_select_own on public.capdent_ai_conversations;
create policy capdent_ai_conversations_select_own on public.capdent_ai_conversations
for select to authenticated
using (user_id = auth.uid());

drop policy if exists capdent_ai_conversations_insert_own on public.capdent_ai_conversations;
create policy capdent_ai_conversations_insert_own on public.capdent_ai_conversations
for insert to authenticated
with check (user_id = auth.uid() and clinic_id in (select clinic_id from public.profiles where id = auth.uid()));

drop policy if exists capdent_ai_conversations_update_own on public.capdent_ai_conversations;
create policy capdent_ai_conversations_update_own on public.capdent_ai_conversations
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and clinic_id in (select clinic_id from public.profiles where id = auth.uid()));

grant select, insert, update on public.capdent_ai_conversations to authenticated;
create index if not exists capdent_ai_conversations_clinic_user_idx on public.capdent_ai_conversations(clinic_id,user_id);
