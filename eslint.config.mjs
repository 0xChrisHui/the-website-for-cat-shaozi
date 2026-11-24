import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import shadcn from "@shadcn/lint";
import playwright from "eslint-plugin-playwright";

const note = { message: "设计规则见 DESIGN.md，请使用语义 token 和已有组件。" };
const testExemptions = ["skip", "fixme", "only", "fail"].map((method) => ({
  selector: "MemberExpression[property.name='" + method + "'][object.name=/^(test|it|describe)$/], MemberExpression[property.name='" +
    method + "'][object.property.name='describe']",
  message: "删除测试豁免或独占标记，修复失败并运行完整验收。",
}));

const config = [
  { ignores: [".ai/**", ".next/**", ".pnpm-store/**", "test-results/**", "playwright-report/**", "contracts/lib/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTypeScript,
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" } },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true }],
      "no-restricted-syntax": ["error", ...testExemptions],
    },
  },
  {
    files: ["src/**/*.tsx"],
    plugins: { shadcn },
    rules: {
      "shadcn/no-raw-colors": ["error", note],
      "shadcn/no-arbitrary-values": ["error", note],
      "shadcn/no-inline-styles": ["error", note],
      "shadcn/no-restyle": ["error", { ...note, componentImports: ["@/components/ui/*"] }],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error", {
        object: "process", property: "env", message: "通过 src/lib/env.ts 取得当前进程可用的配置。",
      }],
    },
  },
  {
    files: ["e2e/acceptance/**/*.ts", "e2e/features/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@playwright/*", "playwright", "playwright-core", "node:*", "http", "https", "net", "undici"], message: "使用受保护的 e2e/support/fixture 和同源请求。" },
        ],
      }],
      "no-restricted-globals": ["error", { name: "fetch", message: "使用 fixture 的同源 api。" }],
      "no-restricted-syntax": ["error", ...testExemptions, {
        selector: "MemberExpression[property.name=/^(route|unroute|routeFromHAR|routeWebSocket|request|newContext|newPage)$/]",
        message: "使用受保护 fixture 提供的 page 和同源 api。",
      }],
    },
  },
  {
    files: ["e2e/**/*.spec.ts"],
    plugins: { playwright },
    rules: {
      "playwright/no-skipped-test": "error",
      "playwright/no-focused-test": "error",
      "playwright/expect-expect": ["error", { assertFunctionNames: ["expect", "assertPage"] }],
    },
  },
];
export default config;
