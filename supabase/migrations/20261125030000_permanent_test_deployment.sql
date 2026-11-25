-- The production role receives column privileges but the restrictive policy permits
-- deployment inserts only from the test worker. Other job columns retain their defaults.
grant insert (kind, payload) on jobs to :"worker_role";

create policy test_deployment_worker_insert on jobs as restrictive for insert to :"worker_role"
  with check (
    current_user = 'test_worker'
    and kind = 'permanent.deploy-contract'
    and schema_version = 1
    and status = 'queued'
    and sample_run_id is null
    and jsonb_typeof(payload) = 'object'
    and payload - array[
      'environment', 'branch', 'chainId', 'reviewedSha', 'releaseSha', 'migrationSha',
      'acceptanceSha', 'artifactHash', 'constructorConfigVersion', 'deploymentVersion'
    ] = '{}'::jsonb
    and payload @> '{"environment":"test","branch":"integration","chainId":11155420}'::jsonb
    and payload->>'deploymentVersion' ~ '^memorial-erc721-v[1-9][0-9]{0,8}$'
    and payload->>'releaseSha' ~ '^[0-9a-f]{40}$'
    and payload->>'reviewedSha' = payload->>'releaseSha'
    and payload->>'migrationSha' = payload->>'releaseSha'
    and payload->>'acceptanceSha' = payload->>'releaseSha'
    and payload->>'artifactHash' ~ '^[0-9a-f]{64}$'
    and payload->>'constructorConfigVersion' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- Existing website job permissions exclude this worker-owned kind.
create policy test_deployment_web_insert on jobs as restrictive for insert to :"web_role"
  with check (kind <> 'permanent.deploy-contract');

create policy test_deployment_web_update on jobs as restrictive for update to :"web_role"
  using (kind <> 'permanent.deploy-contract')
  with check (kind <> 'permanent.deploy-contract');

create unique index jobs_test_deployment_version on jobs ((payload->>'deploymentVersion'))
  where kind = 'permanent.deploy-contract' and schema_version = 1 and sample_run_id is null
    and payload @> '{"environment":"test","chainId":11155420}'::jsonb;

-- A version bump cannot bypass a reserved or unresolved earlier deployment.
create unique index receipts_test_deployment_pending on operation_receipts (network)
  where network = 'op-sepolia' and operation_key like 'test:11155420:memorial-erc721-v%'
    and confirmed_at is null;
