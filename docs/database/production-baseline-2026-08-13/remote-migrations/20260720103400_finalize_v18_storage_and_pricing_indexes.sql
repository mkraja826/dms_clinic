-- Final additive performance and Storage listing hardening for CapDent v18.

begin;

create index if not exists capdent_pricing_shadow_events_clinic_id_idx
  on public.capdent_pricing_shadow_events (clinic_id);

create index if not exists capdent_pricing_shadow_events_profile_id_idx
  on public.capdent_pricing_shadow_events (profile_id);

-- Public object URLs do not require SELECT/list access. Removing this policy
-- prevents authenticated clients from enumerating every clinic logo.
drop policy if exists clinic_logos_select on storage.objects;

commit;
