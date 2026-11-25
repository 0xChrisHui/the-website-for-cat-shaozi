-- Stable photo identity is the intake item ID. Version 1 is its original.
create table test_photo_jobs (
  archive_job_id uuid primary key references jobs(id) deferrable initially deferred,
  bound_item_id uuid not null,
  approved_version_id uuid not null,
  original_ref jsonb not null,
  foreign key (bound_item_id, approved_version_id) references item_versions(item_id, id),
  unique (bound_item_id, approved_version_id)
);
alter table test_photo_jobs enable row level security;
grant select, insert on test_photo_jobs to :"web_role";
grant select on test_photo_jobs to :"worker_role";
create policy test_photo_binding_web_read on test_photo_jobs for select to :"web_role"
  using (current_user = 'test_web');
create policy test_photo_binding_web_insert on test_photo_jobs for insert to :"web_role"
  with check (
    current_user = 'test_web' and exists (
      select 1 from items
      where id = bound_item_id and kind = 'photo' and withdrawn_at is null and exclusion = 'none'
        and exists (select 1 from submissions where id = submission_id and source = 'stage0-grok')
        and exists (select 1 from approvals where item_id = bound_item_id and version_id = approved_version_id
          and source = 'manual' and published and arweave and (not nft or
            recipient_config_version::text = (select value->>'recipientVersion' from site_settings
              where key = 'test.photo-permanent')))
        and exists (select 1 from item_usage_rights where item_id = bound_item_id and arweave
          and (nft or not exists (select 1 from approvals where item_id = bound_item_id
            and version_id = approved_version_id and nft)))
        and exists (select 1 from item_versions where item_id = bound_item_id and id = approved_version_id
          and file_ref->>'objectKey' = submission_id::text || '/' || position::text)
        and exists (select 1 from item_version_display where version_id = approved_version_id
          and processed_media_ref = 'memorial/display/' || bound_item_id::text || '/' || approved_version_id::text)
        and approved_version_id = (select id from item_versions where item_id = bound_item_id
          order by version desc limit 1)
        and original_ref = (select file_ref from item_versions where id = approved_version_id)
        and original_ref = (select file_ref from item_versions where item_id = bound_item_id and version = 1)
    )
  );
create policy test_photo_binding_worker_read on test_photo_jobs for select to :"worker_role"
  using (current_user = 'test_worker');

create policy test_photo_job_web_insert on jobs as restrictive for insert to :"web_role"
  with check (
    kind <> 'permanent.archive-photo' or (
      current_user = 'test_web' and schema_version = 1 and status = 'queued'
      and sample_run_id is null and reason is null
      and exists (
        select 1 from test_photo_jobs where archive_job_id = id
          and payload = jsonb_build_object('itemId', bound_item_id::text)
      )
    )
  );
create policy test_photo_job_web_update on jobs as restrictive for update to :"web_role"
  using (kind <> 'permanent.archive-photo')
  with check (kind <> 'permanent.archive-photo');
create policy test_photo_job_worker_scope on jobs as restrictive to :"worker_role"
  using (kind <> 'permanent.archive-photo' or current_user = 'test_worker')
  with check (kind <> 'permanent.archive-photo' or current_user = 'test_worker');

create table test_photo_receipts (
  item_id uuid not null,
  action text not null check (action in ('archive', 'mint')),
  version_id uuid not null,
  artifact jsonb not null check (
    jsonb_typeof(artifact) = 'object' and coalesce(length(artifact->>'raw'), 0) between 1 and 200000
    and coalesce(length(artifact->>'id'), 0) between 43 and 66 and not (artifact ? 'state')
  ),
  sender text,
  reserved_fee numeric(36,0),
  state text not null default 'signed' check (state in ('signed', 'attempted', 'confirmed')),
  confirmed_at timestamptz,
  primary key (item_id, action),
  foreign key (item_id, version_id) references item_versions(item_id, id),
  check ((state = 'confirmed') = (confirmed_at is not null)),
  check ((action = 'archive' and sender is null and reserved_fee is null) or
    (action = 'mint' and sender is not null and sender ~ '^0x[0-9a-f]{40}$'
      and reserved_fee is not null and reserved_fee > 0))
);
create unique index test_photo_one_unsettled_mint on test_photo_receipts (sender)
  where state <> 'confirmed' and sender is not null;
alter table test_photo_receipts enable row level security;
grant select, insert (item_id, action, version_id, artifact, sender, reserved_fee),
  update (state, confirmed_at) on test_photo_receipts to :"worker_role";
create policy test_photo_receipt_worker on test_photo_receipts to :"worker_role"
  using (current_user = 'test_worker')
  with check (current_user = 'test_worker'
    and exists (select 1 from test_photo_jobs where bound_item_id = item_id
      and approved_version_id = version_id));
