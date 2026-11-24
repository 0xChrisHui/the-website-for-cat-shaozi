# Intake acceptance boundary

The integration rehearsal verifies branch protection and the isolated intake runtime before feature development.

## 本机测试环境初始化阻塞（blocked）

- 分支 `module/intake`，失败时工作树 HEAD `a9ad0f0fe5f391b2e9da590b8025cd81f8b198de`，计划 SHA `389e2c9562952ec7fe83898fc9fb6de27b350f98`。
- Cezar 事件 #6 的 `scope` 通过。2026-11-24 17:08:39 UTC，事件 #10 的 `setup` 执行 `bash .ai/bin/setup-worktree.sh integration`，退出 1，输出「提供普通本机测试环境文件。」事件 #14 的 `prepare_blocked` 通过。
- 已原样重跑初始化，得到相同输出和退出码。只检查文件类型，确认执行器默认的本机测试环境源文件缺失，当前工作树也没有 `.env.local`，且 Git 已忽略该目标文件。工作流未传第二个参数，脚本在检查默认源文件是否为普通文件且非符号链接时退出，尚未进入环境内容校验、锁定安装或 Chromium 探针。
- 地基报告曾在独立工作目录中用合成环境文件通过初始化。恢复时由执行器维护者按现有共享配置为同一运行用户预置普通、非符号链接的测试环境源文件（权限 `0600`）。使用 Mock 或测试沙箱配置，保持生产闸关闭。源文件就绪后重跑 Cezar `setup`，确认工作流传入的目标解析到本次工作树，再核对锁定安装和 Chromium 探针结果。
- 当前锁定安装、`corepack pnpm verify` 和 intake 验收均未验证。初始化成功后按计划运行 `corepack pnpm verify`、intake 单测、`corepack pnpm e2e e2e/features/intake` 和 `corepack pnpm e2e e2e/acceptance/intake.spec.ts`，在交付 SHA 上重新取证。在此之前保留阻塞草稿。
