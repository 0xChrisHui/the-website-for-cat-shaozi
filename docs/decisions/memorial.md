# Memorial 交付决策

状态：待维护者决定（`needs-human`）。任务分支为 `fix/memorial-1`，计划 SHA 为 `389e2c9562952ec7fe83898fc9fb6de27b350f98`，业务基线为 `a9ad0f0fe5f391b2e9da590b8025cd81f8b198de`。

## 阻塞证据

- Cezar 事件日志在 2026-11-24 17:27 UTC 记录 `decide` 路由为 `must_human`，`prepare_human` 输出 `needs-human`，随后进入 `writeup`。工作树的前序提交 `6c04bd56f4718a3f389d38ed5e929257ae766413` 相对业务基线只增加了本决策文档。前序步骤报告冻结依赖安装及 `corepack pnpm verify` 通过（18 项单测）。当时锁定的 memorial 验收返回 `No tests found`，当前交付开关仍为 `false`。
- 计划 2.2 要求公开样本链接可在隐身窗口使用，并仅允许读取该轮已发布的样本。`src/features/foundation/samples.ts` 提供维护样本会话接口，尚缺独立的匿名只读样本票据。地基决策已限定测试票据只用于合成数据。
- 计划 2.1 和 2.2 要求审批时复核白名单和逐项用途授权，公开媒体每次读取时复核当前发布状态并使用展示副本。现有 `SubmissionDraft`、`FileRef`、`ReviewDecision` 和地基表尚未定义如何读取持久化的逐项授权和独立展示副本。投稿决策记录的联调范围是运行时隔离。
- 计划 2.2 要求撤下在同一事务中关闭公开访问、暂停未发送的永久动作、使受影响的快照立即不可下载并使在途导出失效。`permanent` 和 `exports` 的工作器处理器仍为占位实现，现有契约尚未定义发送和导出失效边界。导出决策记录的是范围演练。

## 维护者决定与建议

建议先授权补齐共享契约，并指定负责人和交付顺序。按 `.ai/prompts/must-human.md`，缺共享契约的实现应搁置。若契约设计需要数据库结构变更（含新增字段），请维护者在明确具体变更后单独确认。

1. 由 `foundation` 提供仅 Preview 和本地 Mock 可用的短期匿名只读票据，限定单个 `runId` 内已发布的合成内容。
2. 由 `intake` 与 `memorial` 确定审批可复核的逐项用途授权及展示副本读取契约，使用现有的维护者鉴权和公开投影边界。
3. 由 `memorial`、`permanent` 和 `exports` 先约定撤下事务与工作器共用的发送状态、快照下载失效和在途导出失效接口。可先交付共享契约，导出业务交付继续遵循计划的 memorial 合并和全量预览验收门槛。

## 批次继续方式

若维护者暂缓或拒绝补齐任一共享契约，将 `memorial` 保留为待办草稿，保持其交付开关关闭。按 `docs/modules.json`，`exports` 依赖 `memorial`，应随之搁置。`intake` 和 `permanent` 可在满足各自前置条件后继续独立范围内的工作，并保留各自验收与执行闸。

契约就绪后，沿本分支已有提交恢复实现。保持生产闸关闭，用合成样本覆盖审批、公开当前版本、撤下后旧媒体返回 404 和撤下与导出的竞态。先运行 `corepack pnpm install --frozen-lockfile`、`corepack pnpm verify`、`pnpm exec vitest run src/features/review src/features/public src/app/api/media` 和 `pnpm e2e e2e/features/memorial`。实现就绪时仅开启本板块交付开关，在最终交付 SHA 上重新验证，并运行 `pnpm e2e e2e/acceptance/memorial.spec.ts`，确认锁定断言实际执行且通过，按同一 SHA 取得独立审查、预览和检查证据。
