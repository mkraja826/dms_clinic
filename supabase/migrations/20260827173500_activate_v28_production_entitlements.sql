-- CapDent V28 production activation.
-- Enables production pricing visibility, paid-plan capabilities and quota gates.
-- Existing grandfathering is intentionally preserved so established clinics
-- are not unexpectedly restricted when the global rollout switches turn on.

update public.capdent_pricing_flags
set enabled = true,
    updated_at = now()
where key in (
  'pricing_v2_visible',
  'patient_limit_enforcement',
  'upload_limit_enforcement',
  'storage_limit_enforcement',
  'intelligence_enabled',
  'multi_clinic_enabled'
);

-- Enforcement remains effective only when grandfathered = false, as enforced
-- by get_capdent_entitlements_v2/get_capdent_entitlements_v25.
update public.clinic_pricing_settings
set patient_limit_enforced = true,
    upload_limit_enforced = true,
    storage_limit_enforced = true,
    updated_at = now();

-- Real enforcement is active; shadow mode must remain off.
update public.capdent_pricing_flags
set enabled = false,
    updated_at = now()
where key = 'patient_limit_shadow_mode';
