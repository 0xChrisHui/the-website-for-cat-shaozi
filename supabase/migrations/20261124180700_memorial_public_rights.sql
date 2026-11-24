-- Item-level permissions are explicit. A missing row grants no uses.
create table item_usage_rights (
  item_id uuid primary key references items(id),
  public_view boolean not null default false,
  private_export boolean not null default false,
  arweave boolean not null default false,
  nft boolean not null default false
);

-- Display copy and the processed media key belong to one exact version.
create table item_version_display (
  version_id uuid primary key references item_versions(id),
  title text,
  caption text,
  processed_media_ref text
);

alter table item_usage_rights enable row level security;
alter table item_version_display enable row level security;

grant select, insert, update (public_view, private_export, arweave, nft)
  on item_usage_rights to :"web_role";
grant select, insert, update (title, caption, processed_media_ref)
  on item_version_display to :"web_role";
grant select on item_usage_rights, item_version_display to :"worker_role";

create policy item_usage_rights_web on item_usage_rights to :"web_role"
  using (exists (select 1 from items where id = item_id))
  with check (exists (select 1 from items where id = item_id));

create policy item_usage_rights_worker on item_usage_rights for select to :"worker_role"
  using (exists (select 1 from items where id = item_id));

create policy item_version_display_web on item_version_display to :"web_role"
  using (exists (select 1 from item_versions where id = version_id))
  with check (exists (select 1 from item_versions where id = version_id));

-- The items policy hides withdrawn items from the worker.
create policy item_version_display_worker on item_version_display for select to :"worker_role"
  using (exists (
    select 1
    from item_versions
    where id = version_id and item_id in (select id from items)
  ));
