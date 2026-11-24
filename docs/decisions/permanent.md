# 永久归档模块阻塞记录

- 状态：`blocked`。分支 `module/permanent`，工作树 HEAD `a9ad0f0fe5f391b2e9da590b8025cd81f8b198de`，计划 SHA `389e2c9562952ec7fe83898fc9fb6de27b350f98`。
- 失败证据：Cezar 事件日志中，`scope` 通过。2026-11-24 17:09:51 UTC，`setup` 执行 `bash .ai/bin/setup-worktree.sh integration`，退出码为 1，输出「提供普通本机测试环境文件。」。随后进入 `prepare_blocked`，本次初始化未进入依赖安装或模块验收。
- 原因：命令未传第二个参数，脚本要求默认源 `~/secrets/memorial.env.local` 是普通文件且不是软链。该检查发生在进入目标目录之前。同一提示也用于拒绝目标 `.env.local` 软链。当前工作树内没有 `integration` 子目录或 `.env.local`，未读取默认源，也无法从日志分辨源文件缺失、类型不符、软链或对 runner 不可见。恢复源文件后，工作流传入的 `integration` 仍需处理：脚本第一参数是工作树目录。
- 排查与已知恢复方式：`bash -n .ai/bin/setup-worktree.sh` 和 `git check-ignore .env.local` 已通过。地基决定采用测试专用配置及合成输入，`docs/stage0-report.md` 记录了使用显式合成环境文件完成锁定安装、启动 Chromium 和运行 `verify` 的先例。本轮按限定范围仅写此记录，未配置环境或重跑初始化。
- 下一步：由运行维护者为 runner 提供可读、权限为 `0600` 的普通测试环境文件，使用 Mock 或隔离测试沙箱，保持生产闸关闭。由工作流维护者修正受保护的 `setup` 调用，使其从任务工作树根目录运行 `bash .ai/bin/setup-worktree.sh . <测试环境文件>`，或使用符合约定的默认源。重跑时核对锁定安装和 Chromium 启动，再执行 `corepack pnpm verify` 及计划第 3 节的 Foundry、定向 Vitest、功能和锁定浏览器验收。按实际受检 SHA 记录结果。
