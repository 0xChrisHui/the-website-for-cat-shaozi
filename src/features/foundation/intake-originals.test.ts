import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolClient } from "pg";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { FileRef } from "@/lib/contracts/intake";
import { bindIntakeOriginals } from "./intake-originals";

const submissionId = "b7033240-033c-4200-9980-7cf331627111";
const stagedKey = "stage0/test/f58c9a69-a992-442d-8716-f318855b4ff0";

async function fixture() {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
  const file: FileRef = {
    objectKey: stagedKey, mediaType: "image/png", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const payload = { submissionId, items: [{ position: 0, attachmentRef: file }] };
  const localFile = { ...file, objectKey: submissionId + "/0" };
  return { bytes, file, payload, localFile };
}

function adapters(bytes: Buffer) {
  const calls: string[] = [];
  const state = { stored: null as FileRef | null, rejectCommit: false };
  let uncommitted: FileRef | null = null;
  const db = {
    async query(sql: string, args?: unknown[]) {
      const statement = sql.trim();
      if (statement.startsWith("select v.file_ref")) {
        return { rows: state.stored ? [{ file_ref: state.stored }] : [] };
      }
      if (statement.startsWith("insert into items(")) return { rows: [{ id: submissionId }] };
      if (statement.startsWith("insert into item_versions")) uncommitted = args?.[1] as FileRef;
      if (statement === "commit") {
        calls.push("commit");
        if (state.rejectCommit) throw new Error("Commit failed");
        state.stored = uncommitted;
      }
      if (statement === "rollback") {
        calls.push("rollback");
        uncommitted = null;
      }
      return { rows: [] };
    },
  } as Pick<PoolClient, "query">;
  return {
    db, calls, state,
    staging: {
      async read(key: string) {
        calls.push("read " + key);
        return new Blob([new Uint8Array(bytes)]).stream();
      },
      async remove(key: string) { calls.push("remove " + key); },
    },
  };
}

it("commits the verified reference before cleanup and replays without another upload read", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-originals-"));
  try {
    const { bytes, payload, localFile } = await fixture();
    const { db, calls, staging } = adapters(bytes);
    const originals = bindIntakeOriginals(db, payload, root, staging);
    expect(originals).not.toBeNull();
    const first = originals!.persistPhotos();
    expect(originals!.persistPhotos()).toBe(first);
    expect(await first).toEqual([{ position: 0, status: "persisted", file: localFile }]);
    expect(await readFile(join(root, submissionId, "0"))).toEqual(bytes);
    expect(calls).toEqual(["read " + stagedKey, "commit", "remove " + stagedKey]);

    expect(await bindIntakeOriginals(db, payload, root, staging)?.persistPhotos()).toEqual([
      { position: 0, status: "replayed", file: localFile },
    ]);
    expect(calls).toEqual(["read " + stagedKey, "commit", "remove " + stagedKey, "remove " + stagedKey]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves staging on a database conflict or rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "intake-originals-"));
  try {
    const { bytes, payload, localFile } = await fixture();
    const { db, calls, staging, state } = adapters(bytes);
    state.stored = { ...localFile, sha256: "0".repeat(64) };
    expect(await bindIntakeOriginals(db, payload, root, staging)?.persistPhotos()).toEqual([{ position: 0, status: "conflict" }]);
    expect(calls).toEqual([]);

    state.stored = null;
    state.rejectCommit = true;
    const attempt = bindIntakeOriginals(db, payload, root, staging);
    expect(attempt).not.toBeNull();
    await expect(attempt!.persistPhotos()).rejects.toThrow("Commit failed");
    expect(calls).toEqual(["read " + stagedKey, "commit", "rollback"]);

    state.rejectCommit = false;
    expect(await bindIntakeOriginals(db, payload, root, staging)?.persistPhotos()).toEqual([
      { position: 0, status: "persisted", file: localFile },
    ]);
    expect(await readFile(join(root, submissionId, "0"))).toEqual(bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("never binds duplicate positions or files outside the stage0 test store prefix", async () => {
  const { bytes, file, payload } = await fixture();
  const { db, calls, staging } = adapters(bytes);
  expect(bindIntakeOriginals(db, { ...payload, items: [...payload.items, ...payload.items] }, "/unused", staging)).toBeNull();
  expect(bindIntakeOriginals(db, {
    ...payload, items: [{ position: 0, attachmentRef: { ...file, objectKey: "outside/blocked" } }],
  }, "/unused", staging)).toBeNull();
  expect(calls).toEqual([]);
});
