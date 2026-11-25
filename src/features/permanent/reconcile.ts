import { createHash } from "node:crypto";

export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

export interface Artifact {
  id: string;
  raw: string;
}

export type Stored<T> = T & { state: "signed" | "attempted" | "confirmed" };

export interface Operation<T> {
  receipt: Stored<T> | null;
  stage(artifact: T): Promise<Stored<T>>;
  attempt(): Promise<void>;
  confirm(): Promise<void>;
}

export class PermanentCheck extends Error {}

export function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new PermanentCheck(reason);
}

/** Only a first attempt is authorized. Ambiguous results are recovered by original ID. */
export async function reconcile<T>(operation: Operation<T>, actions: {
  sign(): Promise<T>;
  verify(artifact: T): Promise<boolean>;
  beforeSend(artifact: T): Promise<void>;
  authorize(artifact: T): Promise<void>;
  send(artifact: T): Promise<unknown>;
}): Promise<Stored<T> | null> {
  const stored = operation.receipt ?? await operation.stage(await actions.sign());
  if (await actions.verify(stored)) {
    if (stored.state !== "confirmed") await operation.confirm();
    return stored;
  }
  check(stored.state !== "confirmed", "已确认凭证无法复核");
  if (stored.state === "attempted") return null;
  await actions.beforeSend(stored);
  await actions.authorize(stored);
  await operation.attempt();
  await actions.beforeSend(stored);
  await actions.authorize(stored);
  await actions.send(stored).catch(() => undefined);
  if (!await actions.verify(stored)) return null;
  await operation.confirm();
  return stored;
}
