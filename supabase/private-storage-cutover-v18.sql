-- CapDent v18 post-rollout Storage privacy cutover.
--
-- Run only after the signed-URL v18 build has been released to active users.
-- Older builds render public object URLs directly and will stop displaying
-- clinical images after this transaction commits.

begin;

update storage.buckets
set public = false
where id in ('patient-files', 'prescriptions', 'xrays', 'clinic-logos');

do $$
declare
  remaining_public integer;
begin
  select count(*)
  into remaining_public
  from storage.buckets
  where id in ('patient-files', 'prescriptions', 'xrays', 'clinic-logos')
    and public;

  if remaining_public <> 0 then
    raise exception 'Clinical Storage privacy cutover did not complete';
  end if;
end
$$;

commit;
