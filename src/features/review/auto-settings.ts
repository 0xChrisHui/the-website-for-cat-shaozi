import type { PoolClient } from "pg";
import { z } from "zod";
import { lockExportScope } from "@/features/foundation/private-export";

const key = "review.auto-approval";
const senderHash = z.string().regex(/^[a-f0-9]{64}$/);
const setting = z.object({ sender: senderHash, confirmedAt: z.iso.datetime() });

export async function readAutoApproval(db: PoolClient) {
  const { rows: [row] } = await db.query<{ version: number; value: unknown }>(
    "select version,value from site_settings where key=$1", [key],
  );
  const parsed = setting.safeParse(row?.value);
  return row && parsed.success ? { ...parsed.data, version: row.version } : null;
}

export async function changeAutoApproval(db: PoolClient, enabled: boolean, sender: string) {
  const value = enabled ? { sender: senderHash.parse(sender), confirmedAt: new Date().toISOString() } : {};
  await lockExportScope(db, null);
  await db.query(`
    insert into site_settings (key,version,value) values ($1,1,$2)
    on conflict (key) do update set version=site_settings.version+1,value=excluded.value
  `, [key, value]);
}
