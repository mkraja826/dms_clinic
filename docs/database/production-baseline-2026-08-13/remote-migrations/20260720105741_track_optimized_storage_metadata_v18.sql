-- Persist Storage object identity and compression results for new v18 uploads.
-- Existing file URLs remain unchanged for backward compatibility.

begin;

alter table public.files
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists original_size_bytes bigint,
  add column if not exists stored_size_bytes bigint;

alter table public.files
  drop constraint if exists files_storage_bucket_check,
  add constraint files_storage_bucket_check
    check (
      storage_bucket is null
      or storage_bucket in ('patient-files', 'prescriptions', 'xrays')
    ) not valid,
  drop constraint if exists files_original_size_bytes_check,
  add constraint files_original_size_bytes_check
    check (original_size_bytes is null or original_size_bytes >= 0) not valid,
  drop constraint if exists files_stored_size_bytes_check,
  add constraint files_stored_size_bytes_check
    check (stored_size_bytes is null or stored_size_bytes >= 0) not valid;

-- All current production records use Supabase public object URLs. Extract the
-- stable bucket/path while retaining file_url for older application builds.
update public.files
set
  storage_bucket = split_part(
    split_part(file_url, '/storage/v1/object/public/', 2),
    '/',
    1
  ),
  storage_path = split_part(
    substring(
      split_part(file_url, '/storage/v1/object/public/', 2)
      from position('/' in split_part(file_url, '/storage/v1/object/public/', 2)) + 1
    ),
    '?',
    1
  )
where file_url like '%/storage/v1/object/public/%'
  and (storage_bucket is null or storage_path is null);

update public.files f
set
  mime_type = coalesce(f.mime_type, o.metadata ->> 'mimetype'),
  stored_size_bytes = coalesce(
    f.stored_size_bytes,
    case
      when (o.metadata ->> 'size') ~ '^[0-9]+$'
      then (o.metadata ->> 'size')::bigint
      else null
    end
  )
from storage.objects o
where o.bucket_id = f.storage_bucket
  and o.name = f.storage_path;

comment on column public.files.storage_bucket is
  'Supabase Storage bucket containing the clinical object.';
comment on column public.files.storage_path is
  'Stable object path used for signed URLs and deletion.';
comment on column public.files.original_size_bytes is
  'Client-observed image size before v18 WebP optimization.';
comment on column public.files.stored_size_bytes is
  'Optimized object size uploaded to Supabase Storage.';

commit;
