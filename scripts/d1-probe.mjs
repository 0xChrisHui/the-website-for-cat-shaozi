import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";
import { createPublicClient, http } from "viem";
import { optimismSepolia } from "viem/chains";
import sharp from "sharp";

const action = process.argv[2];

function requireResult(value, check) {
  if (!value) throw new Error("Probe failed: " + check);
  console.log("PASS " + check);
}

async function previewSchema() {
  const url = new URL(process.env.BASE_URL ?? "");
  if (url.protocol !== "https:" || url.origin !== process.env.BASE_URL) throw new Error("Use the verified Preview origin");
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const headers = { origin: url.origin, ...(secret && { "x-vercel-protection-bypass": secret }) };
  const call = (path, init) => fetch(new URL(path, url), {
    ...init, headers: { ...headers, ...init?.headers }, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  requireResult((await call("/api/debug/samples/schema", { method: "POST" })).status === 404, "platform header alone is denied");
  const signIn = await call("/api/debug/samples/session", { method: "POST" });
  requireResult(signIn.ok, "signed sample session");
  const cookie = signIn.headers.getSetCookie().find((line) => line.startsWith("memorial_sample="))?.split(";")[0];
  const { runId } = await signIn.json();
  requireResult(cookie && /^[a-f0-9-]{36}$/.test(runId), "sample run bound to the session");
  const probe = await call("/api/debug/samples/schema", { method: "POST", headers: { cookie }, body: runId });
  const result = probe.ok && await probe.json();
  requireResult(result?.ok && result.runId === runId, "tested website role write/read/cleanup");
}

async function auth() {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (process.env.VERCEL_ENV !== "development" || url.protocol !== "https:" ||
      url.hostname !== process.env.SUPABASE_PROJECT_REF + ".supabase.co") throw new Error("Use the shared project's local test configuration");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const test = createClient(url.toString(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = "stage0-probe-" + crypto.randomUUID() + "@example.invalid";
  for (const [label, run] of [
    ["signup disabled", () => test.auth.signUp({ email, password: crypto.randomUUID() })],
    ["new OTP user disabled", () => test.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })],
    ["anonymous auth disabled", () => test.auth.signInAnonymously()],
  ]) {
    const { data, error } = await run();
    requireResult(error && !data.session && !data.user, label);
  }
  const denied = await test.schema("memorial_test").from("jobs").select("id").limit(0);
  requireResult(denied.error && ["PGRST106", "42501"].includes(denied.error.code), "Data API schema denied");
  const emailSecret = process.env.TEST_MAINTAINER_EMAIL;
  const password = process.env.TEST_MAINTAINER_PASSWORD;
  if (!emailSecret || !password) throw new Error("Supply TEST_MAINTAINER_EMAIL and TEST_MAINTAINER_PASSWORD privately");
  const login = await test.auth.signInWithPassword({ email: emailSecret, password });
  requireResult(login.data.user?.id === process.env.MAINTAINER_UID && login.data.session, "test maintainer logged in");
  const refreshed = await test.auth.refreshSession();
  const saved = refreshed.data.session?.refresh_token;
  requireResult(saved, "refresh succeeds");
  const logout = await test.auth.signOut({ scope: "local" });
  requireResult(!logout.error, "refresh session revoked");
  const old = await test.auth.refreshSession({ refresh_token: saved });
  requireResult(old.error && !old.data.session, "revoked refresh token denied");
}

function requireTestOperator() {
  if (process.env.VERCEL_ENV !== "development" || process.env.CI === "true" ||
    ["ALLOW_MAINNET", "OP_MAINNET_RPC_URL", "MAINNET_WALLET_FILE", "DIARY_ARCHIVE_PASSPHRASE"].some((name) => name in process.env)) {
    throw new Error("Use the isolated D1 test context");
  }
}

async function files() {
  requireTestOperator();
  const paths = process.argv.slice(3);
  if (paths.length !== 3) throw new Error("Provide the three approved test fixtures");
  let heif = false;
  let large = false;
  let orientation = false;
  for (const path of paths) {
    const bytes = await readFile(path);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
    heif ||= metadata.format === "heif";
    large ||= metadata.format === "jpeg" && bytes.length > 4_500_000;
    orientation ||= (metadata.orientation ?? 1) > 1;
    const preview = await sharp(bytes).autoOrient().resize({ width: 1200, withoutEnlargement: true }).jpeg().toBuffer();
    const clean = await sharp(preview).metadata();
    requireResult(!clean.exif && !clean.orientation &&
      createHash("sha256").update(await readFile(path)).digest("hex") === checksum, "metadata stripped from derivative; original unchanged");
  }
  requireResult(heif && large && orientation, "HEVC, size and orientation coverage");
}

async function revoke() {
  requireTestOperator();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const expected = process.env.BLOB_STORE_HOST;
  if (!token || !expected?.endsWith(".private.blob.vercel-storage.com") ||
      process.env.CONFIRM_D1_TEST_BLOB !== expected) throw new Error("Configure only the isolated test Blob store");
  // Only a synthetic object with a random name is ever created or removed.
  const key = "stage0/test/d1-" + randomUUID();
  const object = await put(key, "synthetic D1 probe", { access: "private", token, addRandomSuffix: false, ttlDays: 1,
    abortSignal: AbortSignal.timeout(10_000) });
  try {
    if (new URL(object.url).hostname !== expected) throw new Error("Test store identity mismatch");
    const validUntil = Date.now() + 40_000;
    const delegation = await issueSignedToken({ token, pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(delegation, { operation: "get", access: "private", pathname: key, validUntil });
    if (new URL(presignedUrl).hostname !== expected) throw new Error("Signed URL host mismatch");
    const read = () => fetch(presignedUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000) });
    requireResult((await read()).ok, "private link works");
    await del(object.url, { token, abortSignal: AbortSignal.timeout(10_000) });
    requireResult([403, 404, 410].includes((await read()).status), "old link stops working after deletion");
  } finally {
    await del(object.url, { token, abortSignal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  }
}

async function readiness() {
  requireTestOperator();
  const url = new URL(process.env.OP_SEPOLIA_RPC_URL ?? "");
  if (url.protocol !== "https:") throw new Error("Use the test chain HTTPS endpoint");
  const client = createPublicClient({ chain: optimismSepolia, transport: http(url.href, { timeout: 8000, retryCount: 0 }) });
  requireResult(await client.getChainId() === optimismSepolia.id, "OP Sepolia chain identity");
  if (process.env.TEST_WALLET_FILE) {
    const { privateKeyToAccount } = await import("viem/accounts");
    const privateKey = (await readFile(process.env.TEST_WALLET_FILE, "utf8")).trim();
    if (!/^0x[a-f0-9]{64}$/i.test(privateKey)) throw new Error("Test wallet file format");
    const { address } = privateKeyToAccount(privateKey);
    requireResult(await client.getBalance({ address }) > 0n, "test wallet funded");
    requireResult(Number.isInteger(await client.getTransactionCount({ address, blockTag: "pending" })), "test pending nonce available");
  }
}

try {
  if (action === "schema") await previewSchema();
  else if (action === "auth") { requireTestOperator(); await auth(); }
  else if (action === "files") await files();
  else if (action === "revoke") await revoke();
  else if (action === "readiness") await readiness();
  else throw new Error("Usage: d1-probe.mjs auth|schema|files|revoke|readiness");
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("Probe failed:") ? error.message : "D1 probe could not complete. Check mode, environment and access privately.");
  process.exitCode = 1;
}
