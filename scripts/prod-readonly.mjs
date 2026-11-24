const site = new URL(process.env.PRODUCTION_ORIGIN ?? "");
if (site.protocol !== "https:" || site.origin !== process.env.PRODUCTION_ORIGIN || site.username || site.password) {
  throw new Error("Set PRODUCTION_ORIGIN to the reviewed HTTPS origin");
}
for (const [path, statuses] of [
  ["/", [200]], ["/debug", [404]], ["/api/debug", [404]], ["/debug/samples", [404]],
  ["/maintain", [302, 303, 307]], ["/api/exports/download", [401, 403, 404]],
]) {
  const result = await fetch(new URL(path, site), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000) });
  if (!statuses.includes(result.status) || (path === "/maintain" && new URL(result.headers.get("location") ?? "/", site).href !== site.origin + "/maintain/login")) {
    throw new Error(path + " returned " + result.status);
  }
  console.log(path, result.status);
}
