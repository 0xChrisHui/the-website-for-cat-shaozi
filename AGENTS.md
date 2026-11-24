# 项目规则

- 按任务卡和 docs/modules.json 限定分支、板块与可写文件。
- 开工前读 docs/plan.md、docs/acceptance-script.md 和板块决定。
- 运行 `corepack pnpm install --frozen-lockfile`、`corepack pnpm verify` 和对应验收。
- 使用 .github/protected-paths.txt 核对禁区，首次交接前读 stage0/github/protected-paths.txt。
- 通过共享配置取环境变量，使用 Mock 和测试沙箱。
- 保持生产闸关闭，避开生产数据、真实私钥及账号。
- 保留验收断言和已有功能测试，禁止跳测和行内检查豁免。
- 不登记真实身份、完整任务参数、密钥或原图。
- 最多修三轮，仍失败时记录 SHA、失败证据和恢复步骤并保留草稿。
- 以 exact SHA 对齐独立审查、预览和检查，提交变更后重新取证。
- 通过 PR 交付。禁止 rebase、强推、用标签绕过及自行合并到 main。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
