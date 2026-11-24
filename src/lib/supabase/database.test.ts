import { expect, it, vi } from "vitest";
import { assertDatabaseIdentity, createBusinessPool } from "./database";

it("rejects the wrong project or pool mode before opening a connection", () => {
  const host = "region.pooler.supabase.com";
  for (const url of [
    "postgresql://test_web.other@" + host + ":6543/postgres",
    "postgresql://test_web.fixture@" + host + ":5432/postgres",
    "postgresql://prod_web.fixture@" + host + ":6543/postgres",
  ]) {
    expect(() => createBusinessPool({ url, project: "fixture", host: "region.pooler.supabase.com", scope: "test", actor: "web" }))
      .toThrow("Business connection project, role or pool");
  }
});

it("checks SQL identity and search path", async () => {
  const query = vi.fn();
  const role = "test_web";
  const schema = "memorial_test";
  query.mockResolvedValueOnce({ rows: [{ role, schema, path: "memorial_test, pg_catalog" }] });
  await expect(assertDatabaseIdentity({ query }, role, schema)).resolves.toBeUndefined();
  query.mockResolvedValueOnce({ rows: [{ role, schema, path: "memorial_test" }] });
  await expect(assertDatabaseIdentity({ query }, role, schema)).resolves.toBeUndefined();
  query.mockResolvedValueOnce({ rows: [{ role, schema, path: "memorial_test, public" }] });
  await expect(assertDatabaseIdentity({ query }, role, schema)).rejects.toThrow("Business database identity");
  query.mockResolvedValueOnce({ rows: [{ role, schema: "memorial_prod", path: "memorial_prod, pg_catalog" }] });
  await expect(assertDatabaseIdentity({ query }, role, schema)).rejects.toThrow("Business database identity");
});
