set role test_migrator;
set search_path = memorial_test, pg_catalog;

do $$
declare
  submission uuid := gen_random_uuid();
  photo uuid := gen_random_uuid();
  revision uuid := gen_random_uuid();
  queued uuid := gen_random_uuid();
  original jsonb := jsonb_build_object('objectKey', submission::text || '/0');
begin
  if has_table_privilege('test_worker', 'jobs', 'insert')
     or has_column_privilege('test_worker', 'jobs', 'id', 'insert')
     or has_table_privilege('test_web', 'test_photo_receipts', 'select')
     or has_column_privilege('test_worker', 'test_photo_receipts', 'artifact', 'update')
     or has_table_privilege('test_worker', 'test_photo_receipts', 'delete') then
    raise exception 'unsafe photo privileges';
  end if;
  if not exists (select 1 from pg_policies where schemaname='memorial_test' and tablename='jobs'
    and policyname='test_photo_job_web_insert' and permissive='RESTRICTIVE') then
    raise exception 'photo queue restriction missing';
  end if;
  insert into submissions values (submission, 'synthetic', repeat('a',64), now(), 'stage0-grok');
  insert into items (id,submission_id,position,kind) values (photo,submission,0,'photo');
  insert into item_versions (id,item_id,version,file_ref) values (revision,photo,1,original);
  insert into test_photo_jobs values (queued,photo,revision,original);
  insert into jobs (id,kind,payload,status) values (queued,'permanent.archive-photo',
    jsonb_build_object('itemId',photo),'running');
  begin
    insert into test_photo_jobs values (gen_random_uuid(),photo,revision,original);
    raise exception 'duplicate binding';
  exception when unique_violation then null; end;
  insert into test_photo_receipts (item_id,action,version_id,artifact)
    values (photo,'archive',revision,jsonb_build_object('id',repeat('a',43),'raw','synthetic'));
  update test_photo_receipts set state='attempted' where item_id=photo and state='signed';
  update items set withdrawn_at=now() where id=photo;
end $$;

reset role;

do $$
begin
  if not exists (select 1 from test_photo_jobs join test_photo_receipts on bound_item_id=item_id
      join items on items.id=bound_item_id where withdrawn_at is not null and state='attempted'
        and artifact->>'raw'='synthetic') then
    raise exception 'photo history missing after withdrawal';
  end if;
end $$;

select 'photo SQL assertions passed' as result;
