-- Worker writes are limited to live items from the sender confirmed in maintenance.
grant insert (item_id, version_id, source, published, public_view, private_export)
  on approvals to :"worker_role";
grant insert (item_id, public_view, private_export, arweave, nft), update (public_view, private_export, arweave, nft)
  on item_usage_rights to :"worker_role";
grant insert (version_id, processed_media_ref), update (processed_media_ref)
  on item_version_display to :"worker_role";

create policy approvals_worker_automatic_insert on approvals for insert to :"worker_role"
  with check (source='automatic' and published=public_view and not arweave and not nft
    and recipient_config_version is null and exists (
      select 1 from items where id=item_id
        and exists (
          select 1 from submissions where id=submission_id and source='stage0-grok'
            and sender_hash=(select value->>'sender' from site_settings where key='review.auto-approval'
              and value->>'confirmedAt' is not null)
        )
    ));

create policy item_usage_rights_worker_automatic_insert on item_usage_rights for insert to :"worker_role"
  with check (exists (
    select 1 from items where id=item_id
      and exists (
        select 1 from submissions where id=submission_id and source='stage0-grok'
          and sender_hash=(select value->>'sender' from site_settings where key='review.auto-approval'
            and value->>'confirmedAt' is not null)
      )
  ));

create policy item_usage_rights_worker_automatic_update on item_usage_rights for update to :"worker_role"
  using (exists (
    select 1 from items where id=item_id
      and exists (
        select 1 from submissions where id=submission_id and source='stage0-grok'
          and sender_hash=(select value->>'sender' from site_settings where key='review.auto-approval'
            and value->>'confirmedAt' is not null)
      )
  ));

create policy item_version_display_worker_automatic_insert on item_version_display for insert to :"worker_role"
  with check (exists (
    select 1 from item_versions where id=version_id and exists (
        select 1 from items where id=item_id
          and exists (
            select 1 from submissions where id=submission_id and source='stage0-grok'
              and sender_hash=(select value->>'sender' from site_settings where key='review.auto-approval'
                and value->>'confirmedAt' is not null)
          )
      )
  ));

create policy item_version_display_worker_automatic_update on item_version_display for update to :"worker_role"
  using (exists (
    select 1 from item_versions where id=version_id and exists (
        select 1 from items where id=item_id
          and exists (
            select 1 from submissions where id=submission_id and source='stage0-grok'
              and sender_hash=(select value->>'sender' from site_settings where key='review.auto-approval'
                and value->>'confirmedAt' is not null)
          )
      )
  ));
