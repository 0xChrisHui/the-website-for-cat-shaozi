# 项目一 · 接入清单

按顺序核对。前两项需要等待平台处理或测试币到账。域名购买、生产操作和真实付款见文末。开发期用 Vercel 默认域名，数据库共用一个 Supabase 项目。等密钥、配置、真实链路分别通过后才更新对应状态。仓库里只保留变量名和脱敏结果。

## 测试与开发

| 项目 | 去哪里做 | 本机 `.env.local` | Contabo 服务配置 | Vercel Preview | GitHub Secrets / Environment | 预算或告警 | 回调、冒烟和阶段 | 状态与证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vercel 测试项目与构建队列 | Vercel → Add New → Project，导入项目一，选 Next.js。为 `integration` 保留固定测试别名，各 PR 用自身部署地址 | — | — | — | 非密钥的测试项目标识和实测事件环境名设为 Actions Variables | Pro 团队已启用月度按需消费通知。测试项目使用标准构建机和常规队列。D1 实测套餐内额度足以覆盖本次受控验收。每次实跑前重读用量 | D1 看项目与 Git 导入状态。E2 核对部署 SHA、实际环境名、测试项目标识；生产项目不触发 PR 验收 | D1 已验证。GitHub 导入、Next.js 预设和仅 Preview 构建规则已回读。初始化导入缺少 Next.js，受保护的临时 Preview 已成功。测试项目已关闭按需并发并保留标准构建机。E2 在地基交付后验 Git 部署 SHA、固定别名及生产项目跳过预览 |
| 测试回调固定别名 | Vercel 测试项目的 `integration` 成功部署，在部署详情核对默认分支别名 | — | — | `TEST_CALLBACK_ORIGIN` | — | — | 在 E2 创建 integration 并获得首个成功部署后，核对分支别名与该部署的项目、环境及 SHA，再写入 Vercel Preview 的 TEST_CALLBACK_ORIGIN。E3 实测回调签名与真实投递。 | 未开始。分支和成功部署尚未产生 |
| OP Sepolia 测试币与 RPC | 取现有公共 OP Sepolia RPC，限流时在 Alchemy 建测试应用；从测试网水龙头取测试币 | 本地链或 Mock | `OP_SEPOLIA_RPC_URL`、`ALCHEMY_OP_SEPOLIA_RPC_URL`（按需）、`TEST_EVM_PRIVATE_KEY` | — | — | 只用测试币，RPC 配额据账号核对 | D1 只读查询链 ID、测试余额与 nonce；F2 受控测试部署与铸造 | 已验证。OP Sepolia 链 ID 11155420，测试币已到账 0.01 ETH，待处理 nonce 为 0 |
| 共享 Supabase 项目就绪 | Supabase Dashboard → Projects，使用已就绪的项目 | — | — | — | — | Free；D1 查看实际用量、闲置条件与恢复能力 | D1 项目可用性，独立于 Auth 和业务角色配置 | 已验证。CLI 项目健康，新密码会话通过证书校验，`SELECT 1` 返回 1 |
| Supabase Auth 与测试维护者 | Dashboard → Authentication → Providers/Users，关闭开放注册和匿名登录，预建测试维护者，私下绑定 UID | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`MAINTAINER_UID` | 测试登录探针按需 | 同本机三个变量，绑定测试 UID | — | — | D1 验合成未注册身份不能登录、预建账户登录与登出；E2 在真实 Preview 复验，匿名不能读业务 schema | 已验证。D1 实测注册、OTP 建号、匿名及业务 schema 的 Data API 请求均被拒绝。测试维护者登录、续期、局部登出和旧刷新令牌拒绝通过，账户总数未变。本机和 Preview 三项变量已核对，E2 审实际预览会话 |
| Postgres 测试运行角色 | Supabase CLI 核对项目，Postgres 客户端创建测试角色和 schema，Vercel CLI、SSH 配置测试环境 | `DATABASE_URL`、`DATABASE_CA_CERT_BASE64` | `WORKER_DATABASE_URL`、`DATABASE_CA_CERT_BASE64` | `DATABASE_URL`（服务端 Secret）、`DATABASE_CA_CERT_BASE64` | — | 查看项目配额；本地/CI 测试默认 Mock | D1 核对连接角色、schema、权限和连接模式。E3 实测跨 schema 拒绝及真实任务领取 | 已验证。测试网站事务池与测试工作器会话池已核对 TLS、角色和 schema、建表及切换所有者拒绝。已预配生产 schema 和受限网站、工作器角色，验证两类连接、会话锁与双向跨 schema 授权拒绝。生产 schema 为空，实际业务表按 E3/G2 复验 |
| `db-admin` Environment | GitHub CLI 配置 db-admin，仅允许 main。可信测试迁移由受限角色执行，体检作业单独读取项目级令牌 | — | — | — | Environment `db-admin`，`SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_REF`、`TEST_MIGRATOR_DATABASE_URL` | 核对项目级令牌作用范围，测试迁移角色仅限测试 schema | D1 查看实际分支限制、凭据名及作用范围。E2/E3 验首次迁移、体检和跨环境拒绝 | D1 已验证。仅 main 的分支限制及三项 Secrets 已回读，测试迁移角色已实测建表、授权及越权拒绝。体检令牌按只读权限领取，实际令牌权限、体检和首次迁移由 E2 可信工作流验收 |
| Vercel Preview 自动化放行 | 用 Vercel CLI 调用测试项目的部署保护接口，放行值通过标准输入存入 GitHub 仓库 Secret | — | — | 由 Vercel 平台生成；不作为普通应用变量复制 | `VERCEL_AUTOMATION_BYPASS_SECRET` 仓库级 | — | D1 核对存放位置；E2 带放行头可到达 Preview，应用仍拒绝未授权会话 | 已配置。测试项目生成专用放行密钥、GitHub 仓库 Secret 已核对。平台自动提供同名系统变量，未手动新增应用变量。E2 以真实 Preview 实测带放行头的请求 |
| 测试 Vercel Blob | 测试项目 → Storage → Blob，建测试专用私有 store，接入项目和测试工作器 | `BLOB_READ_WRITE_TOKEN` 按需 | `BLOB_READ_WRITE_TOKEN` 仅测试工作器 | `BLOB_READ_WRITE_TOKEN` 仅测试服务端 | — | Pro 共享套餐内额度已核对。本次有限读写及传输在估算范围内。团队 50%、75%、100% 为按需消费通知。Blob 80% 用量尚需以项目限额和用量计量设定，G2 复核送达 | D1 测三张手机原图直传、HEIC 拉取、删除后旧短链及私有 ZIP 下载。E3 复验最小联调 | D1 已验证。测试私有 Blob 只绑定 Preview，Contabo 用专用凭据拉取。三张合成图签名直传与 SHA-256、HEVC 解码、私有 ZIP 下载通过。合成附件和 ZIP 的短链自然过期返回 403，删除后仍未过期的原链接返回 404。实际 Grok 投递和两类网络验收见对应条目 |
| Grok Bot 联调与白名单 | 在现有 Grok Bot 的私密配置中设测试长令牌及测试回调。用隐藏输入计算白名单邮箱的 SHA-256，Preview 仅录摘要；开发用合成发件信息 | `GROK_INTAKE_TOKEN`、`GROK_SENDER_HASH`，仅合成值 | —（Grok Bot 安全配置独立） | `GROK_INTAKE_TOKEN`、`GROK_SENDER_HASH`、样板限用的 `GROK_SAMPLE_TOKEN` | — | D1 核对提交限流、单事件和暂存量上限；触发时显示短原因 | D1 用临时探针验 Preview 鉴权、发件摘要和签名上传。E3 验稳定测试回调、真实 Grok 投递及同一事件重投只产生一条记录 | D1 已验证。真实白名单摘要仅绑定 Preview，受保护回调实测错令牌 401、非白名单 403，三张合成图签名直传与 Contabo 哈希通过。真实 Grok Bot 及稳定回调的授权配置、投递和重投在 E3 验证 |
| 陆网、原图与离线包 | 维护者用大陆手机网络和家庭宽带各实测测试 Preview，使用本次生成的三张合成样本（含 HEIC） | 合成夹具按需 | 已安装的 HEVC/libvips 与测试盘 | — | — | 首页和首图每次至多 8 秒，两类网络各三次。分别记录存储、传输和请求数。D1 受控 Preview 用量已核算，生产月用量待真实样本 | D1 记录文件大小、哈希、解压结果、撤下旧链接失效和首图耗时。E3 可用同批授权素材 | D1 已验证。三张合成样本覆盖 HEVC 解码、大图直传、方向校正及原件 SHA-256。已下载并解压 9,609,461 字节的合成 ZIP，三个成员哈希匹配。维护者确认手机测试没问题并同意直接通过，未提供逐次耗时和网络原始记录 |
| Contabo 与项目环境文件 | 用管理身份和 `agent` 核对出站和目录。项目测试配置单独置于 `~/secrets/<项目名>.env.local` | — | 按本表配置，专用环境文件权限 600 | — | — | 磁盘 80% 告警，不增加新实例或公网入口 | D1 双身份 SSH、项目文件权限、测试和生产目录分隔、运行角色连通；D3 核对实际工具链 | D1 已验证。两类 SSH、环境文件权限和目录分隔均核对。工作器的测试和生产数据目录分别为 `/var/lib/memorial-worker/test`、`/var/lib/memorial-worker/prod`。生产工作器配置在管理员专用目录，文件 600，开发账户直接读取被拒。两套工作器角色从 Contabo 实测 TLS、会话锁及跨 schema 权限。正式工作器交付后由 G2 启动和复验 |
| Telegram 通知 | 现有 bot 配置保存在 Cezar 的服务环境文件；D3 通过服务器本机转发流程复用 | — | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`（逻辑名 `NOTIFY_BOT_TOKEN`、`NOTIFY_CHAT_ID`） | — | — | 只发约定的四类通知 | D3 验手机收件、卡点带板块 ID、普通合入静默。2.6 另记手机收件 | 已配置。2.6 发信返回 HTTP 200 和 ok=true，使用者已确认手机收件。D3 四类通知待实测 |
| GitHub 公开仓库双锁 | GitHub → Settings → Rules → Rulesets，按 B.6 配 `main-lock`、`production-lock`，随后设置 `integration` 的具名检查及路径守卫 | — | — | — | — | 公开仓库无需 GitHub Pro，D1 核对 Actions 用量及构建排队 | D2 在机器账号获权前查双锁。E3 验无绕过权、机器账号操作被拒、状态与同一 SHA 对齐 | 未开始。已核对仓库公开 |
| 机器账号与两款 AI CLI | D3 在双锁生效后邀请机器账号 Write。在 `agent` 下复用已有登录，不授权 `workflow` | — | `MACHINE_ACCOUNT_TOKEN`（经典令牌仅 `repo`）、`AGENT_CLI_LOGIN`（逻辑名） | — | — | 核对 AI 账号额度与登录续期 | D3 读仓库并跑无界面任务；E3 验机器账号无绕过权限，首夜记录续期 | A1 登录已验。已实测 pnpm 10.34.9、Playwright 1.65.1、Foundry 1.10.0、PostgreSQL 客户端 16.15。Supabase CLI 3.3.0 原生 PostgreSQL 17 的 3 个 pgTAP 断言通过，实例已清理。仓库授权、Cezar 实际工具路径及无界面任务待 D3，E3 验机器账号无绕过，首夜观察续期 |
| Cezar 与提交服务 | 在现有 v0.20.0 用户服务上按 D3 分三组交付，手机和电脑通过已选的访问方式进入 | — | 现有服务配置及 `agent` 登录；使用者已选简化的访问方式 | — | — | 沿用三次修复上限和 12 小时批次截止 | D3 跑图、查 CI、校准实际耗时、演练重启与恢复台账 | 已安装 Cezar 0.20.0。用已装解析器实测一张合规图、四张错误图、分支、回环和引用展开。项目仓库登记、实际任务、CI、通知和重启恢复在 D3 验证 |
| 沙箱、验证 API 与告警 | 本地链和 ArLocal/Mock 先行。测试网源码验证按现有区块浏览器账号；配置工作器通知和磁盘告警 | `TEST_DIARY_ARCHIVE_PASSPHRASE`（合成） | `OP_SEPOLIA_EXPLORER_API_KEY`、`DISK_WARN_PERCENT`、`TURBO_WARN_CREDITS`、`WORKER_NOTIFY_ENDPOINT`、`WORKER_NOTIFY_TOKEN` 按需 | 合成口令和 Mock，`TEST_DIARY_ARCHIVE_PASSPHRASE` | — | 磁盘 80%；模拟低余额；真服务只做有限冒烟 | D1 查测试 RPC 和通知通路。E3 启动工具链和样本队列。F2 验测试链与源码验证 | D1 已验证。Contabo 测试链与工作器数据库可用。80% 磁盘和低于十份合成报价的余额均触发，Telegram 私聊 API 接收。E3 复验工作器，F2 复验测试链与源码验证，G2 复核实价和正式送达 |

### D1 探针

脚本入口为 `scripts/d1-probe.mjs`。Auth 使用已绑定测试 Supabase 配置，邮件和密码由本机受限凭据临时传入 `D1_AUTH_TEST_EMAIL`、`D1_AUTH_TEST_PASSWORD`。在 Contabo 以测试环境文件运行 `readiness`，检查 OP Sepolia、测试连接角色和磁盘阈值。传入 `--simulate-alerts` 并加载现有 Telegram 私聊配置后，向该私聊发送一条标明合成输入的演练消息。实际工作器告警、Turbo 当日报价和生产路径仍需要各自的验证证据。

- `files <仓库外的清单.json>` 使用 `BLOB_READ_WRITE_TOKEN` 读取专用私有测试存储。清单含 `storeId`、三个 `photos` 项和一个 `archive` 项。每个对象写 `pathname`、`bytes`、`sha256`，照片另写 `zipMember`。若已独立核对 EXIF 方向，可写 `orientation`，探针会同时核对解码器读出的方向。大小和哈希取自上传前的授权原件及归档。脚本在受限临时目录落盘，验原图完整性、HEVC 解码、JPEG 转正去元数据及 ZIP 原图成员哈希。
- `revoke <测试存储 ID>` 只会写入和清理当次创建的样本附件及 ZIP。先确认短链接自然过期时对象还在，再核对另一个未过期的绕缓存链接在删除后立刻失败。真实存储须先核对费用范围。

本地回归用 `node --test scripts/d1-probe.test.mjs`。文件探针需要 `@vercel/blob` 2.6.1 或以上、支持 HEVC 的 `sharp` 构建和 `yauzl` 3.4 或以上。运行准备检查需 `viem` 和 `pg`。 地基依赖尚未安装时，可用 npm 安装到仓库外的临时目录，并把该目录的 node_modules 加到探针进程的 NODE_PATH。大陆两类网络的实测仍按 D1.2 记录。

## 人工操作

以下各项由使用者在指定阶段执行。无人值守批次不开启这些操作。

| 项目 | 使用者操作 | 预算、冒烟和阶段 | 状态 |
| --- | --- | --- | --- |
| 域名购买与 DNS | 客户确认后再买和配置，开发使用默认 Vercel 域名 | 先确认购买与续费价格；配置后验证解析和 HTTPS | 未开始，已延后 |
| 生产 Vercel、Blob、Auth 与工作器 | 单独建生产 Vercel/Blob 和生产运行角色、目录。预建生产维护者，验证共用 Auth 下测试身份被拒。发布前保持生产分支锁定和预览跳过 | D1 核对配置项；E2 验预览不触发生产项目；G2 核对正式部署、私有访问和告警 | 已部分配置。独立生产 Vercel 项目已建，Git 暂未连接，所有构建跳过，无部署。私有 Blob、网站数据库与 Grok 令牌仅绑定 Production。Contabo 生产工作器配置已接对应 Blob，生产维护者、Git 发布联调及 G2 验收待完成 |
| 生产迁移 | 管理员通过受限生产 Environment 手动触发，只指向生产 schema，核对已审 SHA | G2 实测真实角色和目标 schema，确认通过后再发布服务 | 未开始 |
| 正式钱包、充值与发布审批 | 私下准备正式签名材料、接收配置、主网 RPC、区块浏览器凭据和日记口令；转币、充值和执行闸由使用者按 G2 操作 | Base ETH、OP Gas、Turbo 预算由使用者确认。只在 G2 按计划做一次合成样本演练，核对交易及费用 | 未开始 |
| 单盘留存与可恢复范围 | 首版无异地备份。使用者核对有哪些已下载私有 ZIP、链上记录及归档副本可回读 | G2 用合成素材确认恢复边界，未归档私有原图失盘会丢失 | 未开始 |
