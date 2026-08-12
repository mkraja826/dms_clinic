begin;

grant update (
  clinic_id,
  user_id,
  install_id
)
on public.device_push_tokens
to authenticated;

commit;
