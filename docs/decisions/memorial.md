# Memorial 交付决策

`fix/memorial-1` 基线为 `a9ad0f0fe5f391b2e9da590b8025cd81f8b198de`，计划 SHA 为 `389e2c9562952ec7fe83898fc9fb6de27b350f98`。初始化已通过，业务实现等待共享契约。

## 决定

本轮不实现 memorial 业务代码，`e2e/acceptance/delivered/memorial.json` 保持 `{"delivered": false}`，搁置并转维护者。这不是可逆的纯测试选择：下面三项缺口都属于「缺共享契约」，`.ai/prompts/must-human.md` 将其与数据库结构变更并列为「做不了」，须搁置。

## 原因

- 计划 2.2 将匿名只读样本票据交给地基。`src/features/foundation/samples.ts` 目前只提供签发和验证维护样本会话的接口。锁定验收需要「打开公开样本」，预览手册要求该链接在隐身窗口工作，且票据只允许读取本轮已发布的样本。
- 计划 2.1 要求审批时重查白名单与逐项用途授权。现有 `SubmissionDraft`、`FileRef` 和地基表未约定如何读取持久化的逐项授权和独立展示副本。`ReviewDecision` 表示维护者选择的动作，公开投影还需读取投稿授权和经处理的展示副本。
- 计划 2.2 要求事务内暂停尚未发送的永久动作，并使在途导出失效。现有共享契约未定义可由撤下事务与永久任务、导出工作器共同检查的发送和失效边界。

## 替代方案

- 在 memorial 板块内自行伪造这三项契约（用 Mock 或本板块私有表代替）：会让公开投影与撤下和 intake、permanent、exports 的真实行为脱节，并可能需要新增字段或表，也会放宽公开可见范围，均需维护者批准。
- 只写测试、不写实现，或把 `memorial.json` 改为 true：会让验收虚报通过，违反保留验收断言的规则。

## 请向维护者确认

1. 地基是否先补齐匿名只读样本票据，范围限定为本轮已发布的样本。由谁交付、什么时候交付。
2. intake 是否提供审批时可复核的逐项用途授权，以及与原件分离的展示副本，并由谁定义读取接口。
3. permanent 和 exports 是否提供与撤下事务共用的发送状态和失效契约，用于暂停未发送动作并使在途导出失效。
4. 如需数据库结构变更，是否批准（当前不得自行做）。

## 恢复步骤

契约就绪后，在交付 SHA 上运行 `corepack pnpm install --frozen-lockfile`、`corepack pnpm verify`、`pnpm exec vitest run src/features/review src/features/public src/app/api/media`、`pnpm e2e e2e/features/memorial` 和锁定的 memorial 验收，再把 `memorial.json` 改为 true。当前该验收返回 0 项（No tests found）。

## 基线证据

冻结依赖安装和 `corepack pnpm verify` 在基线均通过，18 项单测全部通过。交接命令写入运行目录时返回 `EROFS`，本文件保留恢复信息。
