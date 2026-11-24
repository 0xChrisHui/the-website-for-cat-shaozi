import { isCi } from "../env";

export function adapterMode(requested: "mock" | "sandbox", sampleRunId?: string, raw: Record<string, string | undefined> = process.env) {
  if (isCi(raw) || sampleRunId || requested === "mock") return "mock";
  if (raw.VERCEL_ENV === "preview" || raw.VERCEL_ENV === "development" || raw.WORKER_INSTANCE === "test") return "sandbox";
  throw new Error("ADAPTER_MODE");
}
