import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startPhotoLoopback() {
  const state = { sends: [] as string[], confirms: 0, bad: false, gateway: Buffer.alloc(0) };
  const server = createServer(async (req, res) => {
    const path = req.url!;
    if (path === "/tx" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks).toString();
      state.sends.push(raw);
      state.gateway = Buffer.from(JSON.parse(raw).data, "base64url");
      res.end();
    } else if (path.startsWith("/wallet/")) {
      res.end("1000000");
    } else if (path.startsWith("/price/")) {
      res.end("1000");
    } else if (path === "/tx_anchor") {
      res.end(Buffer.alloc(48, 1).toString("base64url"));
    } else if (path.endsWith("/status") && state.confirms > 0) {
      res.end(JSON.stringify({ number_of_confirmations: state.confirms, block_height: 1, block_indep_hash: "block" }));
    } else if (path.length === 44 && state.confirms > 0) {
      res.end(state.bad ? Buffer.from("wrong bytes") : state.gateway);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { state, endpoint, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }) };
}
