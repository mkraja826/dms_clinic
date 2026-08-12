create or replace function public.protect_profile_access_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_clinic_id uuid;
  v_actor_active boolean;
begin
  if v_actor_id is null then
    return new;
  end if;

  select role, clinic_id, active
  into v_actor_role, v_actor_clinic_id, v_actor_active
  from public.profiles
  where id = v_actor_id;

  if not coalesce(v_actor_active, false) then
    raise exception 'Active clinic profile required.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.clinic_id is distinct from old.clinic_id
     or new.created_at is distinct from old.created_at
     or new.invite_code is distinct from old.invite_code then
    raise exception 'Profile identity and clinic assignment cannot be changed.' using errcode = '42501';
  end if;

  if old.id = v_actor_id then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'You cannot change your own role, access status or login email.' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_actor_role not in ('owner','head_doctor')
     or old.clinic_id is distinct from v_actor_clinic_id then
    raise exception 'Only clinic administrators can update staff profiles.' using errcode = '42501';
  end if;

  if old.role = 'owner' then
    raise exception 'Clinic owner access cannot be modified.' using errcode = '42501';
  end if;

  if new.email is distinct from old.email then
    raise exception 'Staff login email must be changed through the authentication workflow.' using errcode = '42501';
  end if;

  if new.role = 'owner' then
    raise exception 'The owner role cannot be assigned through staff management.' using errcode = '42501';
  end if;

  if v_actor_role = 'head_doctor'
     and (old.role = 'head_doctor' or new.role = 'head_doctor') then
    raise exception 'Only the clinic owner can manage head-doctor access.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_access_fields on public.profiles;
create trigger profiles_protect_access_fields
before update on public.profiles
for each row execute function public.protect_profile_access_fields();
