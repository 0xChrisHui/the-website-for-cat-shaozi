create table submissions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  sender_hash text not null check (sender_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null,
  source text not null
);

create table items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id),
  position integer not null check (position >= 0),
  kind text not null check (kind in ('photo', 'diary')),
  exclusion text not null default 'none' check (exclusion in ('none', 'explicit', 'ambiguous')),
  withdrawn_at timestamptz,
  unique(submission_id, position)
);

create table item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id),
  version integer not null check (version > 0),
  local_date date,
  file_ref jsonb,
  diary_text text,
  unique(item_id, version),
  unique(item_id, id)
);

create table approvals (
  item_id uuid not null,
  version_id uuid not null,
  approved_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'automatic')),
  published boolean not null default false,
  public_view boolean not null default false,
  private_export boolean not null default false,
  arweave boolean not null default false,
  nft boolean not null default false,
  recipient_config_version uuid,
  primary key(item_id, version_id),
  foreign key(item_id, version_id) references item_versions(item_id, id)
);

create table site_settings (
  key text primary key,
  version integer not null check (version > 0),
  value jsonb not null
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  schema_version integer not null default 1 check (schema_version > 0),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'needs_attention')),
  reason text check (length(reason) <= 120),
  sample_run_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_real_queue on jobs (created_at, id) where sample_run_id is null and status = 'queued';

create table operation_receipts (
  operation_key text primary key,
  network text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null default '{}',
  confirmed_at timestamptz
);

create table current_export (
  singleton boolean primary key default true check (singleton),
  job_id uuid not null references jobs(id),
  object_key text not null unique,
  downloadable boolean not null default false
);

create table stage0_uploads (
  object_key text primary key,
  event_id text not null,
  sender_hash text not null,
  position integer not null,
  media_type text not null,
  size_bytes integer not null check (size_bytes between 1 and 104857600),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used boolean not null default false
);

create table stage0_samples (
  run_id uuid primary key,
  value text not null check (length(value) <= 80)
);

alter table submissions enable row level security;
alter table items enable row level security;
alter table item_versions enable row level security;
alter table approvals enable row level security;
alter table site_settings enable row level security;
alter table jobs enable row level security;
alter table operation_receipts enable row level security;
alter table current_export enable row level security;
alter table stage0_uploads enable row level security;
alter table stage0_samples enable row level security;

grant select, insert, update on submissions, items, item_versions, approvals, site_settings to :"web_role";
grant select, insert, update on jobs, current_export, stage0_uploads to :"web_role";
grant select, insert, delete on stage0_samples to :"web_role";
grant select on approvals, site_settings, submissions, items to :"worker_role";
grant insert on items to :"worker_role";
create policy items_worker_insert on items for insert to :"worker_role" with check (position >= 0 and withdrawn_at is null and exclusion = 'none');
grant select, insert, update on item_versions, operation_receipts, current_export to :"worker_role";
grant select, update (status, reason, updated_at) on jobs to :"worker_role";

create policy submissions_web on submissions to :"web_role" using (length(source) > 0);
create policy items_web on items to :"web_role" using (position >= 0);
create policy versions_web on item_versions to :"web_role" using (version > 0);
create policy approvals_web on approvals to :"web_role" using (source in ('manual', 'automatic'));
create policy settings_web on site_settings to :"web_role" using (version > 0);
create policy jobs_web on jobs to :"web_role" using (sample_run_id is null);
create policy exports_web on current_export to :"web_role" using (singleton);
create policy uploads_web on stage0_uploads to :"web_role" using (length(object_key) > 0);
create policy samples_web on stage0_samples to :"web_role"
  using (run_id::text = current_setting('memorial.sample_run_id', true))
  with check (run_id::text = current_setting('memorial.sample_run_id', true));

create policy submissions_worker on submissions for select to :"worker_role" using (length(source) > 0);
create policy items_worker on items for select to :"worker_role" using (withdrawn_at is null);
create policy versions_worker on item_versions to :"worker_role" using (version > 0);
create policy approvals_worker on approvals for select to :"worker_role" using (source in ('manual', 'automatic'));
create policy settings_worker on site_settings for select to :"worker_role" using (version > 0);
create policy jobs_worker on jobs to :"worker_role" using (sample_run_id is null);
create policy receipts_worker on operation_receipts to :"worker_role" using (length(operation_key) > 0);
create policy exports_worker on current_export to :"worker_role" using (singleton);
