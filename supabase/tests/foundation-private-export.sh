#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

pg_bin="${PG_BINDIR:-$(pg_config --bindir)}"
export PGHOST
PGHOST=$(mktemp -d /tmp/private-export-test.XXXXXX)
export PGPORT=5432 PGDATABASE=postgres PGUSER PGPASSFILE=/dev/null
unset PGPASSWORD PGSERVICE
PGUSER=$(id -un)
cleanup() {
  "$pg_bin/pg_ctl" -D "$PGHOST/data" -m fast -w stop >/dev/null 2>&1 || true
  rm -rf -- "$PGHOST"
}
trap cleanup EXIT

"$pg_bin/initdb" -D "$PGHOST/data" --auth=trust --no-locale --encoding=UTF8 >"$PGHOST/init.log"
"$pg_bin/pg_ctl" -D "$PGHOST/data" -l "$PGHOST/server.log" \
  -o "-c listen_addresses='' -c unix_socket_directories=$PGHOST" -w start || { cat "$PGHOST/server.log"; exit 1; }
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap-roles.sql >/dev/null
{
  printf '%s\n' 'set role test_migrator;' 'set search_path = memorial_test, pg_catalog;'
  node --input-type=module <<'JS'
import { readFileSync, readdirSync } from "node:fs";
import { safeMigration } from "./.github/scripts/migrate-schema.mjs";
const dir = "supabase/migrations";
for (const name of readdirSync(dir).sort()) {
  console.log(safeMigration(readFileSync(dir + "/" + name, "utf8"), name, "test"));
}
JS
} | psql -X -v ON_ERROR_STOP=1 >/dev/null
node --import tsx supabase/tests/foundation-private-export.ts "$PGHOST"
