import { z } from "zod";

const optional = z.string().min(1).optional();
const https = z.url().refine((value) => new URL(value).protocol === "https:").optional();
const shared = {
  SUPABASE_PROJECT_REF: z.string().regex(/^[a-z0-9]+$/).optional(),
  EXPECTED_DATABASE_HOST: optional,
  BLOB_READ_WRITE_TOKEN: optional,
  BLOB_STORE_HOST: z.string().regex(/^[a-z0-9.-]+$/).optional(),
};
const siteSchema = z.object({
  ...shared,
  NEXT_PUBLIC_SUPABASE_URL: https,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  MAINTAINER_UID: z.uuid().optional(),
  DATABASE_URL: optional,
  APP_ORIGIN: z.url().optional(),
  TEST_CALLBACK_ORIGIN: https,
  SAMPLE_SESSION_SECRET: z.string().min(32).optional(),
  STAGE0_INTAKE_TOKEN: z.string().min(32).optional(),
  GROK_SENDER_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  INTAKE_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(30),
  INTAKE_MAX_STAGED_BYTES: z.coerce.number().int().positive().default(600 * 1024 ** 2),
  INTAKE_MAX_ITEMS: z.coerce.number().int().min(1).max(100).default(12),
  INTAKE_MAX_EVENT_BYTES: z.coerce.number().int().positive().default(300 * 1024 ** 2),
  UPLOAD_GRANT_TTL_SECONDS: z.coerce.number().int().min(1).max(900).default(900),
  VERCEL_GIT_COMMIT_REF: optional,
});
const workerSchema = z.object({
  ...shared,
  WORKER_DATABASE_URL: optional,
  WORKER_FILE_ROOT: optional,
  WORKER_NOTIFY_ENDPOINT: https,
  WORKER_NOTIFY_TOKEN: optional,
  DISK_WARN_PERCENT: z.coerce.number().int().min(1).max(100).default(80),
  TURBO_WARN_CREDITS: z.coerce.number().nonnegative().optional(),
  TURBO_BALANCE_URL: https,
});
const testSandboxSchema = z.object({
  ...shared,
  OP_SEPOLIA_RPC_URL: https,
  TURBO_TEST_URL: https,
  GROK_SANDBOX_URL: https,
});

const productionOnly = [
  "OP_MAINNET_RPC_URL", "OP_MAINNET_EXPLORER_API_KEY", "MAINNET_WALLET_FILE",
  "DIARY_ARCHIVE_PASSPHRASE", "ALLOW_MAINNET", "TURBO_PRODUCTION_URL",
] as const;

type Environment = "development" | "preview" | "production";
type Raw = Record<string, string | undefined>;

function parse<T extends z.ZodRawShape>(schema: z.ZodObject<T>, raw: Raw) {
  const entries = Object.keys(schema.shape).map((key) => [key, raw[key] || undefined]);
  const result = schema.safeParse(Object.fromEntries(entries));
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.path.join(".")).join(", "));
  return result.data;
}

export function assertTestEnvironment(raw: Raw) {
  const found = productionOnly.filter((key) => raw[key] !== undefined);
  if (found.length) throw new Error(found.join(", "));
}

export function readSiteEnv(raw: Raw = process.env) {
  const ci = raw.CI === "true";
  const parsed = z.enum(["development", "preview", "production"]).safeParse(raw.VERCEL_ENV);
  const environment: Environment | undefined = parsed.success ? parsed.data : undefined;
  if (environment !== "production" || ci) assertTestEnvironment(raw);
  const values = ci ? parse(siteSchema, environment === "development" ? { SAMPLE_SESSION_SECRET: raw.SAMPLE_SESSION_SECRET } : {}) : parse(siteSchema, raw);
  if (environment && environment !== "development" && !ci) {
    const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PROJECT_REF", "MAINTAINER_UID", "EXPECTED_DATABASE_HOST", "DATABASE_URL"] as const;
    const missing: string[] = required.filter((key) => !values[key]);
    if (environment === "preview" && !values.SAMPLE_SESSION_SECRET) missing.push("SAMPLE_SESSION_SECRET");
    if (missing.length) throw new Error(missing.join(", "));
  }
  return { ...values, environment, ci };
}

export function readWorkerEnv(raw: Raw = process.env) {
  const instance = z.enum(["test", "prod"]).safeParse(raw.WORKER_INSTANCE);
  if (!instance.success) throw new Error("WORKER_INSTANCE");
  if (instance.data === "test" || raw.CI === "true") assertTestEnvironment(raw);
  return { ...parse(workerSchema, raw), instance: instance.data, ci: raw.CI === "true" };
}

export function readTestSandboxEnv(raw: Raw = process.env) {
  assertTestEnvironment(raw);
  if (raw.CI === "true" || raw.VERCEL_ENV === "production") throw new Error("ADAPTER_MODE");
  return parse(testSandboxSchema, raw);
}

export function diagnosticsEnabled(raw: Raw = process.env) {
  return raw.VERCEL_ENV === "preview" || raw.VERCEL_ENV === "development";
}

export function isCi(raw: Raw = process.env) {
  return raw.CI === "true";
}
