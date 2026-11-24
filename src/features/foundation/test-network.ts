import net from "node:net";

const originalConnect = net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;
const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function requireLoopback(host: string) {
  if (!loopback.has(host)) throw new Error("Test network: use a local loopback service");
}

net.Socket.prototype.connect = function (...args: unknown[]) {
  // Node uses normalized [options, callback] internally for HTTP(S) and net.
  const tuple: unknown[] = Array.isArray(args[0]) ? args[0] : args;
  const options = tuple[0];
  if (typeof options === "object" && options !== null) {
    const target = options as { host?: string; hostname?: string; path?: string; lookup?: unknown };
    if (target.lookup || target.path) throw new Error("Test network: use a local loopback service");
    requireLoopback(target.host ?? target.hostname ?? "localhost");
  } else if (typeof options === "number") {
    requireLoopback(typeof tuple[1] === "string" ? tuple[1] : "localhost");
  } else {
    throw new Error("Test network: use a local loopback service");
  }
  return Reflect.apply(originalConnect, this, args);
};

globalThis.fetch = async (input, init) => {
  const target = new URL(input instanceof Request ? input.url : input);
  requireLoopback(target.hostname);
  return originalFetch(input, { ...init, redirect: "error" });
};
