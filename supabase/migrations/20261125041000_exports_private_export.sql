-- One reservation per generation. Register its key before any external upload.
create table private_export_objects (
  job_id uuid primary key references jobs(id),
  sample_run_id uuid,
  object_key text not null unique,
  state text not null check (state in ('reserved', 'current', 'cleanup')),
  versions jsonb not null default '[]',
  upload_settled boolean not null default false,
  cleanup_after timestamptz not null default '-infinity',
  mock_bytes bytea check (mock_bytes is null or (
    sample_run_id is not null and octet_length(mock_bytes) between 1 and 8388608
  ))
);

create unique index private_export_current_scope on private_export_objects
  (coalesce(sample_run_id::text, 'real')) where state = 'current';

create index private_export_cleanup_scope on private_export_objects
  (cleanup_after, job_id) where sample_run_id is null and state = 'cleanup';

create unique index private_export_active_scope on jobs
  (coalesce(sample_run_id::text, 'real'))
  where kind = 'exports.private-zip' and status in ('queued', 'running');

create policy private_export_sample_jobs_web on jobs to :"web_role"
  using (kind = 'exports.private-zip' and sample_run_id::text = current_setting('memorial.sample_run_id', true))
  with check (kind = 'exports.private-zip' and sample_run_id::text = current_setting('memorial.sample_run_id', true));

create policy private_export_jobs_scope_web on jobs as restrictive to :"web_role"
  using (kind <> 'exports.private-zip' or sample_run_id is not distinct from
    nullif(current_setting('memorial.sample_run_id', true), '')::uuid)
  with check (kind <> 'exports.private-zip' or sample_run_id is not distinct from
    nullif(current_setting('memorial.sample_run_id', true), '')::uuid);

create policy private_export_pointer_scope_web on current_export as restrictive to :"web_role"
  using (coalesce(current_setting('memorial.sample_run_id', true), '') = '')
  with check (coalesce(current_setting('memorial.sample_run_id', true), '') = '');

alter table private_export_objects enable row level security;

grant select, insert, update (state, mock_bytes), delete on private_export_objects to :"web_role";
grant select, insert, update (state, upload_settled, cleanup_after), delete on private_export_objects to :"worker_role";

create policy private_export_objects_web on private_export_objects to :"web_role"
  using (sample_run_id is not distinct from nullif(current_setting('memorial.sample_run_id', true), '')::uuid)
  with check (sample_run_id is not distinct from nullif(current_setting('memorial.sample_run_id', true), '')::uuid);

create policy private_export_objects_worker on private_export_objects to :"worker_role"
  using (sample_run_id is null) with check (sample_run_id is null);
