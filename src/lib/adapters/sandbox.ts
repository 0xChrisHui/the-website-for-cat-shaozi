import { createHash } from "node:crypto";
import { createPublicClient, http } from "viem";
import { optimismSepolia } from "viem/chains";
import { readTestSandboxEnv } from "../env";
import { adapterMode } from "./select";

export interface GrokAdapter { inspect(text: string): Promise<unknown> }
export interface ArchiveAdapter { identify(bytes: Uint8Array): Promise<string> }
export interface ChainAdapter { chainId(): Promise<number> }
export interface BlobAdapter { read(key: string): Promise<ReadableStream<Uint8Array>> }

export function selectSandboxAdapters(requested: "mock" | "sandbox", sampleRunId?: string) {
  const mode = adapterMode(requested, sampleRunId);
  const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const grok: GrokAdapter = { async inspect(value) {
    if (mode === "mock") return { digest: digest(Buffer.from(value)) };
    const { GROK_SANDBOX_URL } = readTestSandboxEnv();
    if (!GROK_SANDBOX_URL) throw new Error("GROK_SANDBOX_URL");
    const response = await fetch(GROK_SANDBOX_URL, { method: "POST", body: JSON.stringify({ text: value }),
      headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Grok sandbox unavailable");
    return response.json();
  } };
  const archive: ArchiveAdapter = { async identify(bytes) {
    if (mode === "mock") return digest(bytes);
    const { TURBO_TEST_URL } = readTestSandboxEnv();
    if (!TURBO_TEST_URL) throw new Error("TURBO_TEST_URL");
    const url = new URL(encodeURIComponent(digest(bytes)), TURBO_TEST_URL.endsWith("/") ? TURBO_TEST_URL : TURBO_TEST_URL + "/");
    const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Archive sandbox unavailable");
    return digest(bytes);
  } };
  const chain: ChainAdapter = { async chainId() {
    if (mode === "mock") return optimismSepolia.id;
    const { OP_SEPOLIA_RPC_URL } = readTestSandboxEnv();
    if (!OP_SEPOLIA_RPC_URL) throw new Error("OP_SEPOLIA_RPC_URL");
    const id = await createPublicClient({ chain: optimismSepolia, transport: http(OP_SEPOLIA_RPC_URL, { timeout: 10_000 }) }).getChainId();
    if (id !== optimismSepolia.id) throw new Error("OP_SEPOLIA_RPC_URL");
    return id;
  } };
  return { mode, grok, archive, chain };
}
