import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
const rules = [
  ["邮箱", /[a-z0-9_.+%-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi],
  ["地址", /\b0x[a-f0-9]{40}\b/gi],
];

const upstream = new Map([
  ["contracts/lib/openzeppelin-contracts/contracts/account/utils/draft-ERC4337Utils.sol", new Set(["0x0000000071727De22E5E9d8BAf0edAc6f37da032", "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"])],
  ["contracts/lib/openzeppelin-contracts/contracts/mocks/token/ERC20ForceApproveMock.sol", new Set(["0xdac17f958d2ee523a2206206994597c13d831ec7"])],
  ["contracts/lib/openzeppelin-contracts/contracts/package.json", new Set(["maintainers@openzeppelin.org"])],
  ["contracts/lib/openzeppelin-contracts/contracts/proxy/Clones.sol", new Set(["0x3d602d80600a3d3981f3363d3d373d3d3d363d73", "0xffffffffffffffffffffffffffffffffffffffff"])],
  ["contracts/lib/openzeppelin-contracts/contracts/utils/Blockhash.sol", new Set(["0x0000F90827F1C53a10cb7A02335B175320002935"])],
  ["contracts/lib/openzeppelin-contracts/contracts/utils/Create2.sol", new Set(["0xffffffffffffffffffffffffffffffffffffffff"])],
  ["docs/plan.md", new Set(["memorial-worker@prod.service"])],
]);
upstream.set("scripts/check-private-identifiers.mjs", new Set([...upstream.values()].flatMap((values) => [...values])));
for (const path of new Set(paths)) {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;
  const source = bytes.toString("utf8");
  for (const [label, regex] of rules) {
    const matches = [...source.matchAll(regex)].map(([value]) => value);
    const unexpected = matches.some((value) => !upstream.get(path)?.has(value) &&
      !(label === "邮箱" && /@(?:example\.(?:com|net|org)|[a-z0-9.-]+\.(?:invalid|test|example|localhost))$/i.test(value)));
    if (unexpected) {
      console.error(path + ": 删除私密" + label + "或换成保留域的合成标识。");
      process.exitCode = 1;
    }
  }
}
