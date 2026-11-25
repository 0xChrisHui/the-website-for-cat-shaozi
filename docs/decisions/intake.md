# Intake acceptance boundary

The integration rehearsal verifies branch protection and the isolated intake runtime before feature development.

## F2 Preview recovery · 2026-11-25

Baseline `8d02e08080b09f4a8cfe82b2e20f713e340da137`, branch `fix/intake-4`.

- The fixed `/api/intake/prepare` and `/api/intake/submit` callbacks delegate to the same test gate and transaction as the E3 debug callbacks. Existing Preview origin and sender configuration determine availability. Dot can continue the existing manual E3 flow.
- The authenticated queue lists a completed submission as 「待审核」 when it has a first-version original that matches the latest real intake job by position, reference metadata and durable-key convention, with no later version, approval, withdrawal or exclusion. Pending and failed jobs retain their existing status. The page shows a photo count, aggregate byte size and Beijing receipt date without exposing private file references, source evidence or identity.
- With a signed sample login, open `/maintain/intake` directly. The shared navigation link is controlled by the delivery flag. The sample exercises one synthetic draft represented by the current URL, replay, per-item and common date hints, an ambiguous hint and explicit date correction. It has no attachment bytes and makes no real intake or database calls. Date corrections survive refresh of the corrected sample URL.

### Needs foundation changes

The authorized intake adapter and worker exchange photo positions and attachment references. The adapter rejects per-photo date hints, diaries and exclusion quotes, and the worker stores first-version file references. The shared boundary needs a durable, versioned draft write/read contract for submission evidence, item date hints and resolutions, diary text, exclusion candidates, per-item failure and original linkage. It also needs transactional supplement and content deduplication rules, including persistent exclusion inheritance and rechecking pending authorization after allowlist removal. The test sample session needs an isolated durable draft contract to model persisted writes, replay across independent navigation, and private attachments. Protected shared paths are required for these changes.

Still open for full acceptance are signed grant reuse and concurrent limit enforcement, repeat-content and supplement cases, item-level repair after a bad original, HEIC-to-JPEG derivation and authorized private media, ambiguous exclusion with public suppression, allowlist removal, and cleanup and retention rules. The test sender and original files remain under the existing manual procedure. The deployed fixed callbacks and the current Dot rows require manual confirmation on the tested Preview SHA. The intake delivery flag stays false.

### Local evidence

Frozen install, `pnpm verify` (71 tests), and the focused Vitest suite (32 tests) passed. A disposable PostgreSQL probe exercised the actual queue SQL with a completed large HEIC reference, a failed job, and approved, withdrawn, excluded, revised, mismatched, missing and sample rows. Browser feature checks passed on desktop and mobile, including refresh and login enforcement for the sample draft URL. The unchanged locked intake spec passed on desktop and mobile with the flag enabled only in a disposable local copy. In the branch configuration the locked spec discovers zero tests.

## F3 · 简化 Dot 草稿交接

「投稿待办」使用现有真实任务与已验证原件作为候选。详情由同一维护者鉴权和样本隔离入口读取，只查固定来源和非样本任务。通过现有 `SubmissionDraft` 契约提供投稿 ID、收件时间、条目和首版本 ID、条目种类、已有日期、审核状态、匹配的持久原件引用及已持久化的日记。页面只显示原件大小和日记文本。审核写入应在自己的事务中核对当前版本与审核资格。

### 需要地基授权的最小写入接口

固定回调把 `IntakeEventV1.items` 收窄成严格的纯照片数组，含日记或逐项原始提示的请求会返回 400。需要在受保护的 `src/features/foundation/intake.ts` 内扩展现有提交事务，保留原请求限制、鉴权、白名单、事件锁、重投响应及照片授权匹配。

- 使用现有 `IntakeEventV1` 的字段。每张照片须含 `attachmentRef`，每篇日记须含 `diaryText`，位置跨两类条目唯一。照片继续使用现有授权及工作器校验。Dot 将原邮件正文作为日记条目的 `diaryText` 发送。
- 原样保存日记到同一投稿的 `items` 与 `item_versions.diary_text`，与投稿和任务在同一事务提交。若调用者另传日期提示或排除原句，将原文随私有稿件保留，供维护者读出，不做解释或推断。
- 有照片时保持现有工作器照片输入 `{ submissionId, items: [{ position, attachmentRef }] }`。纯日记在原提交事务中保存完成，使用同一任务关联与重投响应，不投给要求至少一张照片的工作器。完成的待办再纳入未审核、未撤下的首版日记，保留既有照片资格判断。

此步骤的真实回调仍支持既有照片请求。合成详情测试只能证明已存日记可读，真实 Dot 混合投递需要上述事务接口后才能验收。交付开关保持现值。

### F3 决定记录 · 2026-11-25

**决定（仅限测试，可逆）**　待办详情只读取已存的日记与已核对的原件记录，不放宽固定回调。含日记或逐项原始提示的请求仍返回 400。合成详情测试只证明「已存日记可读」，不声称真实邮件正文已入库。交付开关保持关闭。

**理由**　`docs/plan.md` 规定纯日记、纯照片均可入库，正文与原图应成为同一份私有草稿（问卷 Q03、Q05）。但写入路径在受保护的 `src/features/foundation/intake.ts`，不在 intake 的可写范围内。`.ai/prompts/must-human.md` 将缺少共享契约列为「做不了」并搁置，intake 不能自行绕开，也不能新增迁移替代该事务。

**备选**　（a）在 intake 内另写一条绕过地基事务的日记写入，会破坏同一事务的重投去重和授权匹配，且越权改保护路径，已否决。（b）在 intake 适配层静默丢弃日记字段，会丢失用户原文，已否决。

**撤销**　本步改动只涉及待办列表、详情页、队列读取和测试。还原这些文件即回到 F2 状态，不涉及数据迁移，也不涉及共享路径。

**must_human　向维护者询问**　是否授权对 `src/features/foundation/intake.ts` 做最小扩展。范围：保留现有鉴权、白名单、事件锁和重投响应，在同一事务内将 `diaryText` 原样写入 `items` 与 `item_versions.diary_text`。纯日记在提交事务内完成，不投给要求至少一张照片的工作器。若 `item_versions.diary_text` 不存在，还需确认是否允许新增迁移。授权前，真实 Dot 的正文加原图混合投递无法验收。
