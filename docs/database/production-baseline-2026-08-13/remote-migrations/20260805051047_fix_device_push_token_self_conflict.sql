create or replace function public.retire_duplicate_expo_push_token()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.active then
    update public.device_push_tokens token
    set
      active = false,
      disabled_at = now(),
      last_error = 'Token reassigned to another authenticated installation',
      updated_at = now()
    where token.expo_push_token = new.expo_push_token
      and token.id <> new.id
      and not (
        token.user_id = new.user_id
        and token.install_id = new.install_id
      )
      and token.active;
  end if;

  return new;
end;
$function$;
