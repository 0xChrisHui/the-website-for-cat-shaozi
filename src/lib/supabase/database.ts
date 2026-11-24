import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { readSiteEnv, readWorkerEnv } from "../env";
import type { Database } from "../database.types";

export type BusinessRow<T extends keyof Database["business"]["Tables"]> =
  Database["business"]["Tables"][T]["Row"];

export function createBusinessPool(config: {
  url?: string; project?: string; host?: string; scope: "test" | "prod"; actor: "web" | "worker";
}) {
  const role = config.scope + "_" + config.actor;
  const schema = "memorial_" + config.scope;
  if (!config.url || !config.project || !config.host) throw new Error("Business connection configuration");
  let url: URL;
  try { url = new URL(config.url); } catch { throw new Error("Business connection URL"); }
  const direct = url.hostname === "db." + config.project + ".supabase.co" && url.username === role;
  const pooled = url.hostname.endsWith(".pooler.supabase.com") &&
    url.username === role + "." + config.project &&
    url.port === (config.actor === "web" ? "6543" : "5432");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== config.host ||
      (!pooled && (config.actor === "web" || !direct)) || url.pathname !== "/postgres" ||
      [...url.searchParams.keys()].some((key) => key !== "sslmode")) {
    throw new Error("Business connection project, role or pool");
  }
  url.search = "";
  const pool = new Pool({
    connectionString: url.toString(), ssl: { rejectUnauthorized: true },
    max: config.actor === "web" ? 4 : 1, connectionTimeoutMillis: 5_000,
    query_timeout: 15_000, allowExitOnIdle: true,
  });
  pool.on("error", () => console.error("Business database connection lost"));
  return { pool, role, schema };
}

export async function assertDatabaseIdentity(client: Pick<PoolClient, "query">, role: string, schema: string) {
  const result = await client.query<{ role: string; schema: string; path: string }>(
    "select current_user as role, current_schema() as schema, current_setting('search_path') as path",
  );
  const identity = result.rows[0];
  if (identity?.role !== role || identity.schema !== schema ||
      identity.path.replaceAll(/["\s]/g, "") !== schema + ",pg_catalog") {
    throw new Error("Business database identity");
  }
}

let web: ReturnType<typeof createBusinessPool> | undefined;

export async function withWebsiteDb<T>(run: (client: PoolClient) => Promise<T>) {
  const env = readSiteEnv();
  if (!env.environment || env.ci) throw new Error("Business database unavailable");
  web ??= createBusinessPool({
    url: env.DATABASE_URL, project: env.SUPABASE_PROJECT_REF, host: env.EXPECTED_DATABASE_HOST,
    scope: env.environment === "production" ? "prod" : "test", actor: "web",
  });
  const client = await web.pool.connect();
  try {
    await client.query("begin");
    await assertDatabaseIdentity(client, web.role, web.schema);
    const value = await run(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function workerDatabase() {
  const env = readWorkerEnv();
  if (env.ci) throw new Error("Worker database unavailable");
  return createBusinessPool({
    url: env.WORKER_DATABASE_URL, project: env.SUPABASE_PROJECT_REF, host: env.EXPECTED_DATABASE_HOST,
    scope: env.instance, actor: "worker",
  });
}

export function queryRows<T extends QueryResultRow>(client: PoolClient, sql: string, values: unknown[] = []) {
  return client.query<T>(sql, values).then((result) => result.rows);
}
