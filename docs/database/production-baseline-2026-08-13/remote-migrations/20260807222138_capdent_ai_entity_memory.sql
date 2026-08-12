alter table public.capdent_ai_conversations
  add column if not exists last_entity_type text,
  add column if not exists last_entity_id uuid,
  add column if not exists last_entity_name text;
