// F2 standalone fixture. Pass the installed arlocal@1.1.66 package directory.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, type AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createArLocal } from "./arlocal";
import { createPhotoFixture } from "./photo-fixture";

type Sandbox = {
  app: { listen(port: number, ready: () => void): Server };
  start(): Promise<void>;
  stop(): Promise<void>;
};

export async function runArLocal(packageDir: string) {
  assert(isAbsolute(packageDir), "Use the absolute directory of arlocal@1.1.66");
  const require = createRequire(import.meta.url);
  assert.equal(require(join(packageDir, "package.json")).version, "1.1.66");
  const ArLocal = require(packageDir).default as new (port: number, logs: boolean, dir: string) => Sandbox;
  const root = await mkdtemp(join(tmpdir(), "permanent-f2-"));
  // ArLocal's API only exposes a port. Bind its fixture socket explicitly to loopback.
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const previousDirectory = process.cwd();
  process.chdir(root);
  const instance = new ArLocal(port, false, join(root, "archive"));
  const listen = instance.app.listen.bind(instance.app) as unknown as
    (port: number, address: string, ready: () => void) => Server;
  let server: Server | undefined;
  let listening: Promise<void> | undefined;
  instance.app.listen = (port, ready) => {
    server = listen(port, "127.0.0.1", ready);
    const socket = server;
    listening = new Promise((resolve, reject) => {
      socket.once("listening", resolve);
      socket.once("error", reject);
    });
    return server;
  };

  try {
    await instance.start();
    await listening;
    const endpoint = `http://127.0.0.1:${port}`;
    const key = generateKeyPairSync("rsa", { modulusLength: 4096 }).privateKey;
    const ar = createArLocal(endpoint, key, 1_000_000_000_000n);
    const file = join(root, "journal.json");
    const f = createPhotoFixture(ar, async (snapshot) => {
      const next = file + ".next";
      await writeFile(next, snapshot, { mode: 0o600, flush: true });
      await rename(next, file);
    });
    async function local(path: string) {
      const response = await fetch(endpoint + path, { redirect: "error", signal: AbortSignal.timeout(5000) });
      assert(response.ok, `ArLocal failed: HTTP ${response.status}`);
      return response;
    }
    await local(`/mint/${ar.address}/1000000000000`);
    await f.run();
    assert.equal(f.journal().archive?.state, "attempted");
    await local("/mine");
    await f.run();
    assert.equal(f.state.signs, 0);

    f.restore(await readFile(file, "utf8"));
    for (let block = 0; block < 4; block++) await local("/mine");

    await f.run(f.context(createArLocal(endpoint, key, 1_000_000_000_000n)));
    await f.run();
    assert.equal(f.journal().archive?.state, "confirmed");
    assert.equal(f.journal().mint?.state, "confirmed");
    assert.deepEqual([f.state.signs, f.state.writes, f.state.reads], [1, 1, 1]);
    console.log("ArLocal read-back confirmed, one synthetic OP Sepolia mint verified");
  } finally {
    server?.closeAllConnections();
    await instance.stop();
    process.chdir(previousDirectory);
    await rm(root, { force: true, recursive: true });
  }
}

if (import.meta.main) await runArLocal(process.argv[2] ?? "");
