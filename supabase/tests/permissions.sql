begin;
set local search_path = memorial_test, pg_catalog;
insert into jobs(kind, sample_run_id) values ('fixture', gen_random_uuid()), ('fixture', null);
insert into stage0_samples values ('9ce46643-a1e5-4461-b0b2-84da1f804a6a', 'fixture one'),
  ('020603d3-4047-47a4-8d52-59b50d1e19cf', 'fixture two');

set local session authorization test_worker;
do $$
begin
  if (select count(*) from jobs where kind = 'fixture') <> 1 then
    raise exception 'worker can see sample rows';
  end if;
  begin
    perform 1 from memorial_prod.permission_fixture limit 0;
    raise exception 'worker crossed schema';
  exception when insufficient_privilege then raise notice 'worker cross-schema read SQLSTATE 42501'; end;
  begin
    insert into memorial_prod.permission_fixture values (1);
    raise exception 'worker wrote across schema';
  exception when insufficient_privilege then raise notice 'worker cross-schema write SQLSTATE 42501'; end;
  begin
    create table memorial_test.permission_fixture(id integer);
    raise exception 'worker created a table';
  exception when insufficient_privilege then raise notice 'worker CREATE SQLSTATE 42501'; end;
  begin
    set role prod_worker;
    raise exception 'worker acquired production role';
  exception when insufficient_privilege then raise notice 'worker SET ROLE SQLSTATE 42501'; end;
  begin
    perform 1 from stage0_samples;
    raise exception 'worker accessed sample table';
  exception when insufficient_privilege then raise notice 'worker sample read SQLSTATE 42501'; end;
end $$;

reset session authorization;
set local session authorization test_web;
do $$
begin
  if (select count(*) from jobs where kind = 'fixture') <> 1 then
    raise exception 'website can see worker sample rows';
  end if;
  if (select count(*) from stage0_samples) <> 0 then
    raise exception 'website sample reads require a verified run id';
  end if;
  perform set_config('memorial.sample_run_id', '9ce46643-a1e5-4461-b0b2-84da1f804a6a', true);
  if (select count(*) from stage0_samples) <> 1 then
    raise exception 'website can see other sample runs';
  end if;
  begin
    perform 1 from memorial_prod.permission_fixture limit 0;
    raise exception 'website crossed schema';
  exception when insufficient_privilege then raise notice 'website cross-schema read SQLSTATE 42501'; end;
end $$;
rollback;
