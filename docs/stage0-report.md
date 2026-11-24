# 板块 0 · E2 交接

待维护者在 `stage-0` → `main` 草稿 PR 上核对最终完整 SHA。Cezar 的 `foundation-delivery` 图负责锁定安装、复检、3.2b 独立审查和草稿交付。维护者负责平台配置、测试库迁移和合并。

## 交付范围

| 内容 | 入口和证据 |
| --- | --- |
| 应用外壳、样式和共享契约 | `src/app/`、`src/components/ui/`、`src/lib/contracts/`、`src/lib/policy/content.ts`、`src/lib/maintain-navigation.ts`。业务开关只有 `foundation` 打开。 |
| 测试身份和诊断 | 邮箱密码登录、服务端刷新和 POST 登出；真实任务诊断在 `/debug`，独立签名票据绑定的合成样本在 `/debug/samples`。仅 `integration` Preview 的 schema 探针写、读、清理本轮记录。 |
| 最小测试投稿 | 测试专用 `/api/debug/intake/{prepare,submit}`，限测试回调 origin、Bearer 和白名单摘要；私有 Blob 原件直传，工作器按 schema 持会话锁，原件持久化后登记版本，重复事件返回原任务。 |
| 数据库 | `supabase/migrations/`、`supabase/seed.sql`、`supabase/tests/`、`src/lib/database.types.ts`。SQL 角色和 Auth 分开，应用走网站事务池，工作器走直连或会话池。 |
| 检查与验收 | `AGENTS.md`、`DESIGN.md`、`.env.example`、`.ai/bin/setup-worktree.sh`、`scripts/check-stage0.mjs`、`playwright.config.ts` 和锁定 spec。CI 浏览器只访问经核对的部署 origin。 |
| 可信模板与工作器发布 | `stage0/github/` 保持原相对路径。包含 CI、守卫、Preview 检查及状态发布、迁移和体检、G2 只读模板。系统级单元、测试计时器和部署入口在 `.ai/bin/`。 |

## 本地实测

- Node `24.22.3`，Corepack `0.36.0`，pnpm `10.34.9`，Next.js `16.4.6`。
- Foundry `1.10.0` / Solidity `0.8.30`。本地 ERC-721 冒烟通过，1 条通过，0 条跳过。OpenZeppelin Contracts `v5.4.0` 由 `forge install --no-git` 安装，保留合约源码和许可证。
- 在一次性 PostgreSQL `16.15` 重放迁移和合成夹具，工作器跨 schema 读写、建表与 `SET ROLE` 拒绝。当前类型从同一 schema 的系统目录生成并按 `business` 命名。
- 用临时目录模拟 `.github/` 安装位置运行 actionlint。用 `systemd-analyze verify` 核对工作器、部署服务与计时器。
- `corepack pnpm install --frozen-lockfile --store-dir ./.pnpm-store` 通过，锁文件无需改写。`corepack pnpm verify` 通过类型和零警告 ESLint 检查，5 个文件共 18 条单测通过。
- `corepack pnpm e2e e2e/acceptance` 和 `corepack pnpm exec tsx e2e/support/check-delivered.ts` 通过。桌面和手机各 2 条通过、0 条跳过，均有截图和 axe 附件，未发现 serious/critical 问题。同一工作树的 Linux `corepack pnpm build:webpack` 退出码为 0。此次报告是工作树预检，E2 重新生成并绑定远端部署 SHA。
- 用独立临时工作目录和合成 env 文件运行 `setup-worktree.sh`。锁定安装、Chromium 启动和再次 `corepack pnpm verify` 通过，复制的 `.env.local` 权限为 0600 且被 Git 忽略。
- `corepack pnpm secrets`、`node scripts/check-stage0.mjs`、两个 shell 脚本的语法检查和 `git diff --check` 均通过。

## 偏差与决定

- 本地与可信工作流使用一次性 PostgreSQL 16 及同一套受信脚本重放，用规范化的目录类型逐字节核对。当前容器无 Docker 或 Podman，Supabase CLI 返回 `LegacyContainerRuntimeNotFoundError`。可信迁移模板配置了另外一轮 Supabase CLI 生成结果比对，E2 验证官方生成器与项目级 advisors。用本地 Supabase 做现场重放时，先在只放配置的临时目录运行 `supabase db reset --local --no-seed --workdir "$LOCAL_SUPABASE_DIR"`，再装本地角色夹具并用可信脚本重放；迁移文件中的保留角色占位符由可信脚本替换。后续新增字段类型超出当前生成器映射时先补可信生成器。
- 共享项目的初次测试迁移和生产迁移由维护者手动触发。后续测试 schema 按可信合并记录应用。业务对象使用计划中的 Vercel 私有 Blob，Supabase 不额外分配公开业务 bucket。
- 合成网页样本保存在 HttpOnly 签名票据，默认 30 分钟，仅本轮浏览器可读写。真实测试记录及迁移探针走测试 SQL。保留仓库既有 D3 图和执行器。可信发布同时发同名 commit status 和 check run，E2/E3 需验证 GitHub 的归属和 Cezar 的检查来源约束。
- ESLint v9 下四条 shadcn 规则使用当前插件的 `message` 配置。已冻结的 `.ai/` D3 脚本保留原样，由自己的检查入口维护。Turbo 传递依赖安装有可选原生模块和 peer 提示，实际 Turbo 沙箱留待 F2。
- 站点只部署保底主题。四个正式业务板块保持未交付，锁定 spec 中的操作和可访问名称供各板块实现。

## E2 操作顺序

1. 在 GitHub 仓库 **Settings → Rules → Rulesets** 核对 `main-lock` 仅维护者可更新，禁删除和强推；`production-lock` 对尚不存在的 `production` 限制创建、更新和删除，仅维护者可绕过。进入 **Settings → General → Pull Requests**，打开 Allow auto-merge、squash merge 和 merge commit。核对仓库可见性符合 D2 决定。记录 `gh ruleset check main` 与 `gh ruleset check production` 的输出。 [GitHub 规则集文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository)
2. 在 Supabase 控制台 **Authentication → Sign In / Providers** 关闭注册和匿名登录，在 **Users** 预建测试与正式维护者且分别记 UID。**Data API** 的暴露 schema 不包含 `memorial_test`、`memorial_prod`。预建两个 schema、六个独立角色，参照角色夹具的 schema 权限，现场使用独立 LOGIN 角色；应用角色默认 `search_path` 指向自己的 schema、`pg_catalog`。运行角色无建库、建角色、表所有权、`BYPASSRLS`、其他环境 schema 权限或角色成员关系。测试迁移角色只能管理测试 schema 自有对象。核对 `PUBLIC` 默认授权、网站 6543 事务池、工作器 5432 会话池或直连、迁移 5432 会话池和 TLS。 [Supabase Auth 设置](https://supabase.com/docs/guides/auth/general-configuration)
3. GitHub **Settings → Environments** 建仅允许 `main` 的 `db-admin`。在环境中配置受限测试角色的 `SCHEMA_DATABASE_URL`、项目标识及预期数据库主机。验证测试迁移和管理体检所用凭据的实际权限；体检令牌由体检步骤独立使用。G2 才配置 `prod-db-admin` 与正式迁移凭据及套餐支持的审批。仓库级敏感值仅保留测试 Vercel 放行密钥。把维护者登录名和部署筛选字段填在 **Settings → Secrets and variables → Actions → Variables**，变量名见 `.env.example`。
4. 维护者先安装暂存的 `migrate.yml`、`db-advisors.yml` 及 `scripts/` 可信依赖到锁定的默认分支 `main`。若要在首次合并前出具具名 e2e 状态，同一可信安装同时放置 `e2e.yml`、`e2e-status.yml` 及其依赖。让 `stage-0` 合入该提交，再将其余 `stage0/github/` 内容按相对路径迁至 `.github/`，清理已迁副本，保留 `prod-readonly.yml` 到 G2 再启用。维护者核对移动后工作流、目标分支与完整 PR SHA。首次守卫缺失或命中受保护文件时，由维护者记原因并审核放行这次引导。
5. 在 Vercel 测试项目 **Settings → Git** 关联仓库，**Settings → Build and Deployment** 设 Node 24，**Settings → Environment Variables** 只向 Preview 填测试 Auth UID、受限测试网站连接、测试 Blob 和票据配置。稳定 `integration` 默认别名确认后再填 `TEST_CALLBACK_ORIGIN`。在 **Deployment Protection → Protection Bypass for Automation** 生成测试放行密钥并配置 GitHub 同名 secret。正式项目生产分支暂设 `production`，在 **Git → Ignored Build Step** 拒绝 PR 和非生产构建。用临时分支记录正式项目确实没有可用预览以及检查的实际状态。 [Vercel 环境变量](https://vercel.com/docs/environment-variables) · [Vercel 自动化放行](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
6. 在 GitHub **Actions → exclusive manual schema migration → Run workflow** 选 `main`、`bootstrap-test`，填写当前 PR 编号和完整 SHA。独立核过该版本后把同一 SHA 写入 `REVIEWED_MIGRATION_SHA`。核对迁移、类型工件、RLS 权限夹具及独立测库体检。保存提交、迁移名与校验值。测试项目体检凭据的范围须另行记录。确认完毕移除临时核准变量。
7. 到 PR 的 **Checks** 和 Vercel **Deployments → Deployment Details** 逐项对齐当前完整 SHA。保存真实 `deployment_status` 脱敏样本。确认项目 ID、actor ID、environment、deployment SHA、有随机段的不可变部署 host 和 TLS；若事件字段与模板不同，先核实来源再按实测调整。核对 `verify`、可信 `guard`、可信 `e2e` 与测试项目 Vercel 检查。浏览器报告应有桌面与手机截图、axe 结果，以及同 SHA 的零跳过核对。
8. 放行进入同一部署，先确认首页显示「首页」「维护后台」；不带应用身份时 `/debug` 和诊断 API 返回应用 404。用错密码试一次，正确账号登录并刷新，打开「任务诊断」→「查看样本」。创建并保存合成样本，刷新后仍在；样本会话读不到真实诊断。退出后 `/maintain` 回登录，`/debug` 和 API 返回 404。用 D1 探针私下复验测试账号和旧刷新令牌；确认站内无注册入口，正式 UID 在测试预览被拒。Windows 同 SHA 用 `corepack pnpm dev:webpack` 验 200、`corepack pnpm build:webpack` 验退出码 0。
9. 维护者绑定当前头 SHA，以 merge commit 合入地基。由维护者从更新后的 `main` 创建 `integration`。对 `integration` 的首个 SHA 核对引导台账、`integration-schema` 工件、schema 探针和全量浏览器报告。服务器用 `agent` 在干净 worktree 运行 `setup-worktree.sh <目录> <测试环境文件>` 和 `corepack pnpm verify`。确认文件权限 0600 且排除在 Git 外。再按系统级单元安装测试版工作器和计时器，给 `agent` 只读查询用令牌，sudo 只放行维护者核准的工作器单元 stop/start。验证同 SHA 工件后才切换 `current`。记录失败时的 systemd journal 告警路径。
10. 把各步的 SHA、规则集、部署和工件位置记入 `docs/field-notes.md`。提交、部署或相关配置变化后重新取证。

## E3 待验证

- 建立 `integration` 规则集。PR 必须经检查且仅 squash，审批数按计划为 0，禁强推和删除，取消 strict，只维护者绕过。`main-lock` 保持仅维护者可更新且只允许 merge commit。验证具名检查来源，实际演练机器账号直推、创建 `production`、目标 `main` 全绿 PR 自动合并均被拒。核对 D3 检查来源、失效 SHA 撤自动合并和重启恢复。
- 演练行内豁免、硬编码颜色、跳测、绕过 fixture、合成隐私标识、关闭及删除开关、锁定 spec 改动、跨板块修改以及破坏守卫。确认改动触发同 SHA 红灯，`fix/foundation-1` 改首页被拒而 `memorial` 首页所有权允许。
- 用两个演练迁移 PR 覆盖反序时间戳与合并顺序、重复事件和错误来源。检查漏 RLS 拒绝、生产 schema 未变、双向真实角色拒绝 SQLSTATE `42501`，以及每个合并 SHA 自己的类型工件、schema 探针和全量报告。
- E3 用三张获准测试原件覆盖 HEIC、超 4.5 MB JPEG 和 EXIF 方向，检查持久化、重投去重、坏件隔离、错误 Bearer 401、工作器重启和同 schema 二次启动拒绝。用授权测试 Blob 验证旧读链接失效。测试工作器告警实际送达和错误 SHA 不部署。
- 从真正的夜间 runner 验证环境文件、`/proc/<pid>/environ`、journal、systemd 和生产目录的隔离，私下记通过或失败。生产运行、迁移、监控及签名闸仍由 G2 操作。
- 将首版分支和可信触发变化回填手册 B.2、B.5、B.7、3.1、3.5、E/F。登记共享项目、受限角色、首次与正式迁移由人触发、系统级 worker 发布、D3 节点与等待修订、G2 首版恢复范围例外。
