import { statfs } from "node:fs/promises";
import { z } from "zod";
import type { readWorkerEnv } from "@/lib/env";

export interface AlertAdapter { send(message: string): Promise<void> }
type WorkerEnv = ReturnType<typeof readWorkerEnv>;

export function createNotifier(env: WorkerEnv): AlertAdapter {
  return { async send(message) {
    if (env.ci || !env.WORKER_NOTIFY_ENDPOINT || !env.WORKER_NOTIFY_TOKEN) {
      console.warn(message);
      return;
    }
    const result = await fetch(env.WORKER_NOTIFY_ENDPOINT, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", authorization: "Bearer " + env.WORKER_NOTIFY_TOKEN },
      body: JSON.stringify({ message }),
    });
    if (!result.ok) throw new Error("Worker notification failed");
  } };
}

export async function checkThresholds(env: WorkerEnv, notify: AlertAdapter) {
  if (env.WORKER_FILE_ROOT) {
    const disk = await statfs(env.WORKER_FILE_ROOT);
    if (disk.blocks > 0 && 100 * (disk.blocks - disk.bavail) / disk.blocks >= env.DISK_WARN_PERCENT) {
      await notify.send("工作器磁盘达到告警阈值");
    }
  }
  if (!env.ci && env.TURBO_BALANCE_URL && env.TURBO_WARN_CREDITS !== undefined) {
    const response = await fetch(env.TURBO_BALANCE_URL, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Worker balance unavailable");
    const balance = z.object({ credits: z.number().nonnegative() }).parse(await response.json());
    if (balance.credits <= env.TURBO_WARN_CREDITS) await notify.send("归档额度达到告警阈值");
  }
}
