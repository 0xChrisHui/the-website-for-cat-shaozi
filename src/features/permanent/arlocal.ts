import {
  constants, createHash, createPublicKey, sign, verify, type KeyObject,
} from "node:crypto";
import { deepHash } from "@dha-team/arbundles";
import { z } from "zod";
import { archiveLimit, readBounded } from "./archive-photo";
import { check, sha256, type Artifact } from "./reconcile";

const hash = (data: Uint8Array) => createHash("sha256").update(data).digest();
const encode = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");
const decode = (data: string) => Buffer.from(data, "base64url");
const id = z.string().regex(/^[\w-]{43}$/);
const tag = { name: encode("Content-Type"), value: encode("image/jpeg") };
const transaction = z.object({
  format: z.literal(2), id, last_tx: z.string().regex(/^[\w-]{0,64}$/),
  owner: z.string().regex(/^[\w-]{683}$/),
  tags: z.tuple([z.object({ name: z.literal(tag.name), value: z.literal(tag.value) }).strict()]),
  target: z.literal(""), quantity: z.literal("0"), data: z.string().max(133334),
  data_size: z.string(), data_root: id, reward: z.string().regex(/^[0-9]{1,30}$/),
  signature: z.string().regex(/^[\w-]{683}$/),
}).strict();
type Transaction = z.infer<typeof transaction>;
type Unsigned = Omit<Transaction, "id" | "signature">;

export type ArchiveArtifact = Artifact & { digest: string; versionId: string };

function dataRoot(data: Uint8Array) {
  // At this size the Arweave v2 Merkle tree is a single leaf.
  const end = Buffer.alloc(32);
  end.writeUInt32BE(data.byteLength, 28);
  return encode(hash(Buffer.concat([hash(hash(data)), hash(end)])));
}

function signatureData(tx: Unsigned) {
  return deepHash([
    Buffer.from("2"), decode(tx.owner), Buffer.alloc(0), Buffer.from("0"),
    Buffer.from(tx.reward), decode(tx.last_tx), [[decode(tag.name), decode(tag.value)]],
    Buffer.from(tx.data_size), decode(tx.data_root),
  ]);
}

const padding = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };

export function createArLocal(endpoint: string, key: KeyObject, rewardLimit: bigint, signal?: AbortSignal) {
  const url = new URL(endpoint);
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash,
  "ArLocal 必须使用显式 IPv4 回环端口");
  const { n: owner, e } = createPublicKey(key).export({ format: "jwk" });
  check(owner && owner.length === 683 && e === "AQAB", "ArLocal 需要合成 RSA 4096 签名器");
  const address = encode(hash(decode(owner)));
  const request = (path: string, init?: RequestInit) => {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(5000);
    return fetch(new URL(path, url), {
      ...init, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  };

  async function validate(artifact: ArchiveArtifact) {
    const tx = transaction.parse(JSON.parse(artifact.raw));
    const bytes = decode(tx.data);
    check(tx.id === artifact.id && encode(hash(decode(tx.signature))) === tx.id &&
      tx.owner === owner && bytes.length > 0 && bytes.length <= archiveLimit &&
      tx.data_size === String(bytes.length) && tx.data_root === dataRoot(bytes) &&
      sha256(bytes) === artifact.digest && verify("sha256", await signatureData(tx),
        { key: createPublicKey(key), ...padding }, decode(tx.signature)),
    "ArLocal 签名凭证不符");
    return tx;
  }

  async function checkFunds(reward: bigint) {
    const response = await request(`/wallet/${address}/balance`);
    if (!response.ok) throw new Error("ArLocal balance unavailable");
    const balance = await response.text();
    check(/^[0-9]{1,30}$/.test(balance) && reward >= 0n &&
      reward <= rewardLimit && BigInt(balance) >= reward, "ArLocal 测试预算或余额不足");
  }

  return {
    address,
    async sign(bytes: Buffer, versionId: string, authorize: () => Promise<void>): Promise<ArchiveArtifact> {
      check(bytes.length > 0 && bytes.length <= archiveLimit, "归档图片超出字节限制");
      const [anchor, price] = await Promise.all([request("/tx_anchor"), request(`/price/${bytes.length}`)]);
      if (!anchor.ok || !price.ok) throw new Error("ArLocal quote unavailable");
      const [last_tx, reward] = await Promise.all([anchor.text(), price.text()]);
      check(/^[\w-]{0,64}$/.test(last_tx) && /^[0-9]{1,30}$/.test(reward), "ArLocal 报价不符");
      await checkFunds(BigInt(reward));
      const tx: Unsigned = {
        format: 2, last_tx, owner, tags: [tag], target: "", quantity: "0", reward,
        data: encode(bytes), data_size: String(bytes.length), data_root: dataRoot(bytes),
      };
      const message = await signatureData(tx);
      await authorize();
      signal?.throwIfAborted();
      const signature = sign("sha256", message, { key, ...padding });
      const id = encode(hash(signature));
      return { id, raw: JSON.stringify({ ...tx, id, signature: encode(signature) }),
        digest: sha256(bytes), versionId };
    },
    async verify(artifact: ArchiveArtifact) {
      await validate(artifact);
      const tx = await request(`/tx/${artifact.id}/status`);
      if (tx.status === 404 || tx.status === 202) return false;
      if (!tx.ok) throw new Error("ArLocal status unavailable");
      const body = await tx.text();
      if (body === "Pending") return false;
      const status = z.object({
        block_height: z.number().int().nonnegative(), block_indep_hash: z.string().min(1),
        number_of_confirmations: z.number().int().nonnegative(),
      }).parse(JSON.parse(body));
      if (status.number_of_confirmations < 3) return false;
      const gateway = await request(`/${artifact.id}`);
      if (gateway.status === 404) return false;
      if (!gateway.ok || !gateway.body) throw new Error("ArLocal data unavailable");
      check(sha256(await readBounded(gateway.body, archiveLimit)) === artifact.digest, "归档回读哈希不符");
      return true;
    },
    async beforeSend(artifact: ArchiveArtifact) {
      await checkFunds(BigInt((await validate(artifact)).reward));
    },
    async send(artifact: ArchiveArtifact) {
      await request("/tx", { method: "POST", headers: { "content-type": "application/json" }, body: artifact.raw });
    },
  };
}

export type ArLocal = ReturnType<typeof createArLocal>;
