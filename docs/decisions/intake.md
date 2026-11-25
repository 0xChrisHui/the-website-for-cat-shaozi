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

### F3 · 维护者待决定

**阻塞点**　在 `fix/intake-5` 的实现提交 `1026d3a4fe93bcc5d13a23e20579252004dcc2f6`，固定 `/api/intake/submit` 仍委托地基处理。地基的 `imageEvent` 将共享 `IntakeEventV1.items` 收窄为严格的照片数组，带日记或逐项原文提示会在写入之前返回 HTTP 400。信件级 `commonDateHint` 可通过输入校验，但提交事务不保存它。当前受保护清单和 Stage 0 清单均保护 `src/features/foundation/`，且该路径未列入 intake 的写入范围。

**请维护者决定**　是否另开并授权一项针对 `src/features/foundation/intake.ts` 的地基修复，再让 intake 接续验收。建议批准上节的最小事务接口。沿用共享契约接收照片和日记，保留 Bot 鉴权、发件人白名单、上传授权匹配、原件核验和事件重投响应。在同一事务内用现有 `items` 与 `item_versions.diary_text` 保存首版日记。现有迁移已声明该列并授予网站角色写入权限，日记本身无需迁移。另传的 `commonDateHint`、`dateHint`、`exclusionQuote` 可随现有私有任务 JSON 保存，并在鉴权详情中按投稿和条目位置展示原文。照片工作器继续读取现有照片列表，日记专投保留同样的任务关联并在提交事务内完成。授权后用合成数据核对两个不同事件、同一事件重投、混合与纯日记入库、原图核验和未登录访问，再按同一提交 SHA 取验收证据。

**若不批准**　把 F3 正文入库和真实 Dot 混合投递验收留在草稿，继续现有纯照片测试链路。保留此分支已完成的待办布局和鉴权详情，供后续独立审查。批次可继续处理无需这一写入接口的板块。intake 交付开关保持关闭。

**Cezar 证据**　事件 #67 记录冻结安装完成，#206 记录 `pnpm verify` 通过 73 项测试。#169 的浏览器命令因本地端口 3100 被占用而未启动，#260 使用临时配置重跑，样本功能测试在桌面和移动端各通过一项。这些是实现阶段的本地记录，真实 Dot 混合投递、两次实际入库加重投和同 SHA 的预览仍待验收。#378 记录 `prepare_human` 成功设置 `needs-human`，等待上述授权。
