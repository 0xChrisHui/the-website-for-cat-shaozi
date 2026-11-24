# 猫咪纪念网站实施计划

> 执行时使用 Superpowers `executing-plans` 逐卡完成。板块和返修按手册由 Cezar 调度。每张卡先写测试或探针及预期，再实现并运行该卡的命令。本文是 C3 评审采纳稿。卡中标为【待使用者决定】的事项在 C3 收到答复后定稿，开跑前锁定计划和清单。

**目标**　交付邮件投稿、单维护者审核、公开首页与时间线、最新版日记、永久归档及 NFT、唯一一份私有离线 ZIP、可配置的纪念日展示。

**架构**　一个 Vercel 应用提供网站和 API，Supabase 保存结构化数据、权限与任务。Grok 将原件直传 Vercel Blob，Contabo 的 systemd 工作器主动拉取、处理、签名并回写结果。各板块经受保护的共享契约交接。

**技术栈**　Next.js App Router、TypeScript、Tailwind CSS、shadcn/ui、Supabase Postgres + Auth、Vercel Blob、Grok Bot、Contabo、Turbo + Arweave、viem + Foundry + OpenZeppelin、GitHub Actions、Vitest、Playwright。

**依据**　[方向评审后的草案](plan-draft.md)、[需求原话](requirements.md)、[产品问卷及第九节澄清](questionnaire.md)、[使用者定稿补充](#全局约束)和[工作流手册](workflow-manual.md)。发生冲突时，以使用者定稿决定为准。评审以这些决定为前提。

## 全局约束

- 网站分测试和生产 Vercel 项目，各使用自己的固定 `*.vercel.app` 地址。域名购买与 DNS 配置延后至客户确认后。测试和生产共用一个已开通的免费 Supabase 项目，仅用 Postgres + Auth。项目统一关闭开放注册和匿名登录，Auth 用户目录和签发者共用，各环境预建一个维护者账号并由服务端匹配独立身份。业务数据用 `memorial_test`、`memorial_prod` 两个 schema、各自的网站与工作器运行角色、显式 grants 和 RLS 隔离。文件存 Vercel Blob 和 Contabo 磁盘。
- Grok Bot 是唯一收件入口。网站验证 Bot 令牌并判断 Grok 自报的发件人。发件人可被冒充，前期逐封人工确认，开启自动审批即视为接受并记录确认时间。D1 由使用者私下设置白名单，首批只有使用者自己的邮箱。真实邮箱不写入任何文件、样本或日志，开发与 CI 使用合成身份。首版站点不对外发邮件，沟通由维护者自行处理。
- `真实 Arweave 写入`、`OP 主网交易`、`自动审批` 三个开关独立且默认关。自动审批无每日数量上限和自动过期。只将拒绝、授权不明、要求改收款地址、钱包余额不足、结果未知转人工。其它输入异常进入技术补件或失败流程，影响授权时归入授权不明。业务待办和夜间开发运行互相独立。关停或撤下阻止尚未发出的动作，已发出的继续核对。
- 明确不上链的照片只在后端保存并在私有数据库内可见，任何站内页面均不渲染这张照片，站内媒体和单图下载入口拒绝传出图像。已有私有业务记录可显示处理状态。获准私下留存及导出的可放入唯一一份维护者离线 ZIP，禁止进 Arweave、铸造和空投。再次生成覆盖当前包。分享版延期。
- 首版不做异地备份，范围包含数据库与文件。不上链原图在 Blob 暂存件清理后只存在 Contabo 一块盘上，磁盘损坏会丢失。启用磁盘 80% 告警。
- Contabo 无公网入口。按测试和生产分目录，由现有 `agent` 用户运行 systemd 服务，与 Cezar、Codex 共用该账号。工作器用按业务 schema 分键的 PostgreSQL 会话锁，每环境单实例，断线后先停领和停发，重新获锁后先恢复旧任务。Postgres 使用直连或会话模式。
- Turbo 由使用者以 Base ETH 充值。每个环境配置的一把 EVM 私钥签 Arweave 数据项并承担 OP Gas，按已接受的例外也可与其他项目共用，同一地址在 Base 和 OP 有余额，也同时是该环境合约的部署者、owner、初始 minter。owner 可用 `setMinter` 更换 minter，部署后不转 owner。测试和评审通过后自动部署测试网和主网，主网受 `OP 主网交易` 与 `ALLOW_MAINNET=true` 双闸；真实 Arweave 写入也需要独立开关与执行闸。真实猫名禁止写入仓库、合约、NFT 元数据或测试样本。费用以可用余额为上限，扣除在途占用，程序不自动充值。
- B.7 的两项例外为共用 Supabase 项目与共用 `agent` 用户的钱包文件。项目级 Auth 管理、`service_role`、管理令牌和项目所有者数据库凭据可能触达生产数据，隔离范围是业务 schema 与受限角色。开发 AI 使用测试运行角色，接触项目级管理或迁移凭据会有触达生产数据的风险。钱包私钥只放 Contabo 的 `agent` 用户 `~/secrets/`，目录 `0700`、文件 `0600`。使用者已接受夜间 AI 及以 `agent` 运行且共用钱包的其他项目 AI 能读到私钥。失窃时旧合约失守，只能重新部署，既有 NFT 留在原合约。疑似泄露时停止签名并核对在途交易。
- 采用合成或获准的测试素材。真实猫名、邮箱、白名单、钱包地址及凭据均由使用者在约定阶段私下配置。无人值守期间按手册 3.4、3.5.3 执行。普通可逆选择由执行者记入本板块决定文件，疑难走 `need_decision`，最多三次测试环境可撤回的代决。`verify`、CI、审查退回和基线冲突共用三次修复；权限、额度或不可逆动作受阻时留草稿、记卡点、通知并释放名额。下游等含上游合并提交的全量 e2e，60 分钟未通过记为跳过，独立开发继续。开批由维护者在 F1 发起，D3 的 `agent` systemd 提交器固定清单版本，原子记录批次、运行号、PR 和验收 SHA，重启先对账。全终态或 12 小时出摘要，达到批次截止时间如实列出仍在运行的任务。正常收尾再提交一次 `final-report`，报告 PR 指向 `integration`，更新 `docs/run-report.md`。

## 评审重点

| 故障输入 | 应有行为和测试归属 |
| --- | --- |
| 手机原图超过函数请求体上限，三张图中有坏件 | 文件直传，单件失败有编号，其余保留。D1、0.5、1.2。 |
| 发件人被冒充、明确排除的照片重投 | 自动审批默认关，排除继承到同一素材，公开入口和永久任务同时被挡。1.1、1.3、2.2。 |
| 已审核 PR 带迁移，预览先于迁移结束 | 测试库按合并顺序迁移，类型和权限核对后才开放同 SHA 全量 e2e。0.7。 |
| 部署广播后掉线，重跑时链上状态不确定 | 从已持久化交易核对，任何重播使用原始签名交易。3.1。 |
| 生成 ZIP 与撤下同时发生，旧链接已发放 | 下载入口立刻关闭、旧对象撤下、失效的生成不能重新开放下载。D1、2.2、4.1。 |
| Windows 本地 Turbopack 构建报错 | 用 webpack 启动和构建同一提交，记录复验结果。0.1、E2。 |
| 共用 Auth 项目的注册和跨环境会话 | 关闭开放注册，预建账号按环境核验 UID，实测刷新和登出。D1.1、0.4。 |
| 大陆网络加载慢、Blob 免费额度不足、旧短链仍可读或 `sharp` 不解 HEVC | D1.2 分别实测并记录上线卡点。 |

## 交付顺序与检查约定

| ID | 开工依赖 | 交付线 |
| --- | --- | --- |
| `foundation` | D1–D3 的接入、锁仓、执行器冒烟 | `stage-0` → `main`，过 E2、E3 两道门 |
| `intake` | `foundation` 门二 | `module/intake` → `integration` |
| `memorial` | `foundation` 门二 | `module/memorial` → `integration`；`review`、`public` 同批交付，共用一个开关 |
| `permanent` | `foundation` 门二 | `module/permanent` → `integration`；开发用合成授权，F2 验真实板块联动 |
| `exports` | `memorial` 合并且含该合并的 `integration` 预览全量 e2e 通过 | `module/exports` → `integration` |

- Cezar 并发从两条线开始，最多三条线。`fix/<ID>-<序号>`、`skin/<名称>`、`report/<日期>` 同样向 `integration` 提 PR。合并到 `integration` 用 squash，进 `main` 用 merge commit，禁 rebase 与强推。每个业务板块只能改自身列出的路径，通配符按仓库相对路径匹配。各板块只能通过共享契约、持久数据、合成样本交接，禁止互引其他 `src/features/` 私有实现。地基先建首页、维护入口、`src/features/{intake,review,permanent,exports}/jobs.ts` 四个插座、各板块交付开关和初始迁移。可信 guard 按 0.6 用目标分支的地基交付开关收口；业务开工仍须过 E3。并行时每个业务路径只归一个板块。
- 板块 1–4 共用的额外可写路径是 `e2e/features/<ID>/**`、`docs/decisions/<ID>.md`、自己的 `e2e/acceptance/delivered/<ID>.json`，以及只新增 `supabase/migrations/[0-9]{14}_<ID>_*.sql`，其中 `[0-9]{14}` 表示 14 位 UTC 时间戳，JSON 用 14 个 glob 数字位表达。禁止重写已存在迁移，遇时间戳冲突时仅在合入前重命名本板块新文件并重跑审核。`foundation` 先冻结其余共享路径。B.2 全部受保护路径及本计划新增的保护文件以 `.github/protected-paths.txt` 为唯一机器清单。未获授权的共有改动写决策文件和 PR「需要地基变更」节。PR 四节为「完成内容」「决策」「需要地基变更」「卡点」。
- PR 跑 `verify`（`pnpm typecheck` → `pnpm lint` → `pnpm test`）、`pnpm secrets`、可信 `guard`、该提交的 Preview e2e（已开启的 `e2e/acceptance` 加本 PR 板块的 `e2e/features/<ID>`）；构建由 Vercel 完成。`integration` **每次合并**后，对合并 SHA 的 Vercel Preview 跑完整 `pnpm e2e`，覆盖当时全部已交付板块和可用功能测试。Cezar 在受审 SHA 上核对全部必过检查，同步后重新审核；用 `gh pr merge --match-head-commit <审核SHA>`。下游按已合并且全量 e2e 通过的基线开工。
- 自动化默认使用本地 Mock 或测试沙箱桩，禁止在 CI 高频重试中真实调用 Grok、Blob 文件接口、付费或限流 RPC、Turbo 等。应用场景测试允许在专用测试库写入合成数据，测试库管理工作流只承担迁移、类型核对和体检。浏览器测试仅断言功能、基础可用性、无未捕获错误、WCAG 对比度等 axe 规则和手机无横向溢出，严禁像素级截图对比；截图仅作目检证据。真实服务的有限次数验证见 D1、E2/E3、F2 和 G2。
- 任务卡的实现和本地/CI 检查标【AI 自动】，只用合成数据、Mock 或本地沙箱作为板块完成条件。D1/D3、E2/E3、F2、G1、G2 的现场操作标【人工·阶段】，由阶段负责人执行，板块 agent 跳过。C4 将以上标记和预览点选步骤写入 `docs/acceptance-script.md`。`pnpm exec vitest run <目录>` 跑定向单测，`pnpm e2e <目录或 spec>` 跑定向浏览器验收。地基据本计划和 C4 锁定按钮、链接、标题、状态的可访问名称。
- D1 只准备现有免费 Supabase 项目和 Vercel 默认地址。域名购买、DNS 配置和异地备份账号及凭据均从当前等待项移除。
- D1 待接入项未验证前从自动运行清单排除。尚无专用令牌时不启用云端体检，私有测试 Blob 用现有 Pro 的套餐内额度。开始真实媒体联调前再次核对当期额度和测试量，并确认授权样本。测试回调别名在 integration 部署后核对，开发期只使用 Mock 和合成输入。
- `docs/modules.json` 当前为 C3 临时清单，已同步本轮采纳的路径。其根只含 `modules`，每个条目只含 `id`、`dependsOn`、`writablePaths`。C3 收到答复后按定稿重生成，逐项核对 ID、直接依赖、相对路径及分阶段守卫。D2 将定稿随文档放上 `main`，服务器从 `origin/main` 读取并在开批时固定提交号。
- 【人工·D3】保留现有板块划分、节点和每板块一个 PR。用 Cezar v0.20.0 的运行记录和冒烟演练测代表性任务耗时与批次截止；沿用三次共用修复上限和 12 小时批次截止。到期出摘要并记录仍在跑的任务及已有草稿。

## D1 · 接入、真实素材和上线前输入

D1 临时探针完成鉴权、上传和拉取验收。稳定测试回调配置及真实 Grok Bot 投递移到 E3 的最小真实链路，继续保留真实投递、重投与持久化要求。

### D1.1 · 环境隔离与登录

- [ ] 【人工·D1】配置测试和生产各自的 Vercel 项目、私有 Blob store、Contabo 磁盘目录和 Grok 交稿令牌。E2 核对首个成功部署后，将测试项目指向 `integration` 的稳定 `*.vercel.app` 别名写入 `TEST_CALLBACK_ORIGIN`，`PROD_CALLBACK_ORIGIN` 取生产稳定地址。PR 验收用部署专属 URL。生产项目的生产分支先设为不存在的 `production`，为该项目配置按 Git ref 和生产环境筛选的 Ignored Build Step，拒绝全部分支及 PR Preview 构建，G2 随发布改允许 `main`。D1 暂核设置，E2 用临时分支实测无可用生产预览部署、无生产项目 PR 检查；若平台保留跳过记录，记录实测状态。D2/D3 授予机器账号写权限前验证 `production-lock`、`main-lock`。
- [ ] 【人工·D1】在同一 Supabase 项目关开放注册和匿名登录，预建两个维护者，私下绑定各自 UID，预配测试、生产两个 schema 和独立运行角色。后台只提供邮箱密码登录，不提供 OTP、魔法链接或密码找回入口；核对共享 Auth 中相应流程的实际配置与可用限制。白名单首批一人，D1 按 1.1 私下计算并录入摘要。确认日记口令格式为普通话拼音连写、全小写、无声调、无空格或连字符，`ü` 写作 `v`，NFC 规范化；口令不进仓库。配置 Preview 放行与 Contabo 出站。
- [ ] 【人工·D1】运行 `node scripts/d1-probe.mjs auth`。以合成未建账号发起 `signUp`、允许尝试创建用户的 `signInWithOtp` 和匿名登录，验证关闭注册的结果、未创建会话，匿名 key 经 Data API 访问业务 schema 被拒；预建测试身份能登录、刷新，登出后旧刷新令牌失效。用户数由维护者在控制台比较前后并记脱敏结论。探针以测试配置运行，无项目级管理凭据，输出编号和通过状态。D1 临时探针由接入执行者提供，0.4 收口；E2 用实际预览、G2 用正式站复验会话、环境身份与登出。 [Supabase Auth 设置](https://supabase.com/docs/guides/auth/general-configuration) · [Next.js 服务端会话](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework&router=pages)
- [ ] 【人工·D1】用 0.2 连接矩阵及 `readiness` 分别验证网站、工作器、可信 runner 的连通性、池连接用户名写法、目标角色/schema 与跨环境权限。查项目级管理令牌实际授权范围、`prod-db-admin` 审批能力及测试迁移权限，记录额外影响面和未验证项。用当前仓库与套餐设置核对 Vercel 部署次数、构建并发、两项目触发、Hobby 用途资格及 Actions 配额，结果记入接入清单，资格或预算不满足记上线卡点。

### D1.2 · 手机原图、HEVC、大陆访问和 Blob 额度

- [ ] 【人工·D1】在测试项目用临时探针实测交稿协议与签名直传。维护者同意复用三张合成样本，覆盖真实 HEVC 编码、至少一张超过 4.5 MB 的 JPEG 和带 EXIF 方向标记的 JPEG。用工作器真实拉取并核对大小、SHA-256 和磁盘。以部署版 `sharp` 读 HEIC、校方向、生成无元数据 JPEG、重算原件哈希确认保留原件。HEVC 解码失败则在 Contabo 装带 libheif 与 HEVC 解码支持的 libvips，用原批样本复测。记录版本、样本尺寸和通过状态。
- [ ] 【人工·D1】用大陆手机网络和家庭宽带各打开测试预览首页，加载展示图，做三次冷载并各下载一份真实大小的 ZIP。记录成功率、耗时、传输字节数，并核对每次下载的 SHA-256。两次均与同一归档的 SHA-256 一致时，解压和清单成员校验只做一次，已核对的同一归档可复用。以两类网络三次均成功、首页和首图每次均不超过 8 秒为首版验收线。未达标就减小展示尺寸、分页及延迟加载并复测一次。结合实测月流量和图片数量，用账单面板记录存储峰值、传输量和各类操作数，计入原图、展示图、ZIP 和短链访问，公开读取传输和 `/api/media` 调用量单列。按 1.2、2.2 设置限流和 Blob 用量 80% 告警，D1 核对配置能力，G2 复核。三项分别按当前套餐费率估算并与套餐内剩余额度对照，预计无超额费用才通过。超额先收紧图尺寸和暂存保留期并复算，仍超额则记录 G2 上线卡点，测试开发继续走 Mock。
- [ ] 【人工·D1】为测试暂存件和 ZIP 各签发一个未过期的私有读链接，先读成功，再删除对象，马上用原链接从新会话复读。用不可复用对象键及 `useCache: false` 验证旧链接读不到对象，记录撤下动作到失败响应的时差和自然过期的结果。若失败，核对已删除的是链接绑定的对象、签名包含绕缓存配置且请求达到源站后复测一次。复测仍失败则关闭相应直下入口、记录 D1 卡点，真实文件发布不放行。先完成 D1 再进入无人值守。
- [ ] 【人工·D1】**自动检查**　D1 单次运行 `node scripts/d1-probe.mjs files` 与 `node scripts/d1-probe.mjs revoke`，校验 3 个对象的大小、哈希、HEIC 解码、旧链接和超期链接失效，出具原图、ZIP 和耗时记录。大陆网络用测试预览链接按上两步现场实测。CI 用合成大文件与 Mock 验相同接口。 [Vercel 函数体积限制](https://vercel.com/docs/functions/limitations) · [Blob 签名链接](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob) · [Blob 一致读](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage) · [Blob 用量计费](https://vercel.com/docs/vercel-blob/usage-and-pricing) · [sharp HEIC 支持](https://sharp.pixelplumbing.com/api-output/#heif)

### D1.3 · 钱包、磁盘告警和通知

- [ ] 【人工·D1】准备 OP Sepolia 公共 RPC、测试币和区别于生产配置的测试钱包，公共 RPC 限流时切换预先配置的 Alchemy OP Sepolia。生产用单独 Alchemy OP Mainnet 项目。准备 Base ETH、OP ETH 和 Turbo 充值渠道、测试和正式源码验证 API key。D1 私下准备各环境的固定接收地址，站点设置就绪后由维护者录入，版本规则见 2.1。构造参数预设中性名称 `Memorial Photos`、符号 `MEMORIAL`。Turbo 免费份额按服务实时查询，常规预算计入充值。G2 放行前的交付和测试签名进程均不持生产开关或解档口令。
- [ ] 【人工·D1】实测链 ID、钱包实有余额及 `pending` nonce。同站在途预留只覆盖本工作器的已知操作，共用钱包的外部交易可改变余额和 nonce。签名前重查，不明冲突按 3.1/3.2 停发和对账。
- [ ] 【人工·D1】Contabo 磁盘达到 80% 时告警，Turbo 可用余额低于当日测试报价的 10 个典型 100 KB 数据项费用时告警。通知用现有 Cezar 通道，缺省 Telegram Bot，只发部署号、任务号和短原因。用模拟阈值触发通知，G2 核对正式服务告警送达。
- [ ] 【人工·D1】**自动检查**　D1 单次运行 `node scripts/d1-probe.mjs readiness`，核对 OP Sepolia 链 ID、测试钱包 Gas、磁盘和余额告警通知、测试与生产工作器路径及角色配置，凭据与地址脱敏。生产入金、充值和真实运行依 G2 放行。 [Turbo 充值及免费额度](https://docs.ar.io/build/upload/turbo-credits)

## 板块 0 · `foundation` 地基

**范围**　单线 `stage-0`。地基可写清单参见 `docs/modules.json` 的 `foundation` 条目；按 0.6 在可信目标分支切换范围。交付 0.1–0.9 的应用骨架、依赖、共用类型与表、RLS、Mock/沙箱适配器、维护鉴权、主题、任务诊断、worktree 脚本、预览样板、锁定验收、工作流及交接证据。首个项目的 `.github/` 产物先按相对路径写到 `stage0/github/`。Cezar 图、审查提示词、提交服务和运行台账由 D3 交付，地基只接入并证明运行。

**禁碰**　生产服务与数据、真实签名材料、已定的需求与评审输入、`docs/modules.json`、D3 已冻结的 Cezar 图与执行脚本、四块正式业务功能和功能测试。地基可写首页、维护入口外壳及工作器空插座，E3 后将这些路径移交本计划的业务所有者。0.5 可实现测试样板路由及工作进程。地基写工作流模板，E2 由使用者在已锁的目标分支安装。

**预览验收**

1. 【人工·E2】打开地基 PR 对应 Vercel 预览链接，见标题「首页」和导航「首页」「维护后台」。在 PR 检查和 Vercel 部署详情核对同一完整 SHA；有新提交则重验。以 Vercel 平台放行进入该预览，未登录访问 `/debug` 看到应用返回 404。点「维护后台」→「登录」，输入预建测试账号，打开 `/debug` 看到「任务记录」；点「查看样本」可读写测试样本，刷新后仍可见。点「退出登录」，重开维护页被转到登录，`/debug` 和诊断 API 返回 404。样本账号无法读真实测试任务。平台拦截页不作为应用 404 证据。
2. 【人工·E2】由维护者合入后，打开 `integration` 稳定预览，确认首页外壳正常，Vercel 部署详情属于 `integration`。在新 worktree 跑一次同步脚本和 `pnpm verify`，复制的 `.env.local` 为测试环境文件且未进 Git。
3. 【人工·E3】使用已配置的测试 Grok 从白名单地址发送三张授权手机原图。回到 `integration` 预览以测试维护者打开 `/debug`，点「查看样本」，按投递编号见一条私有记录、三件已入库；刷新后仍在。重投相同事件，记录数仍为一。用一件损坏测试附件重投新事件，其余件仍在，按编号在「任务记录」找到「需处理」及简短原因。故意带错凭据提交返回 401，匿名或 Mock 样本会话读不到该真实测试记录。按 0.9 逐个确认 E3 的故障和规则演练。

板块 1–4 的合成场景从预览「维护后台」→「样本登录」进入。每次登录分配独立 `runId`。真实联调使用「登录」。各板块在同一交付 PR 中开启自己的开关，再执行锁定 spec 核对该项确实运行。

### 0.1 · 应用骨架与核心依赖（B.2、B.3）

- [ ] 【AI 自动】在 `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`next.config.ts`、`postcss.config.mjs`、`components.json`、`.gitattributes` 固定版本与配置。锁定 Node 24（Contabo 推荐 24.22.3，最低 24.13）与 pnpm。预装 React、Next.js、TypeScript、`server-only`、Tailwind、shadcn/ui 的按钮、输入、标签、勾选、开关、表格、弹窗与提示组件、`@supabase/supabase-js`、`@supabase/ssr`、`pg` 与 `@types/pg`、`@vercel/blob`、Zod、`sharp`、`@ardrive/turbo-sdk` 及 EVM signer、`viem`、ZIP 流式库、`tsx`、Vitest、Playwright Chromium、`@axe-core/playwright`、ESLint 和 secretlint。`contracts/foundry.toml`、`contracts/remappings.txt` 固定 Foundry、Solidity、OpenZeppelin 的工具和依赖版本，`contracts/lib/**` 由地基统一安装保护，用所锁定的 Foundry 支持的 `forge install --no-git` 安装并直接入库，避免子模块。固定编译器和优化器、关闭 bytecode 的 metadata 哈希供 3.1 复现。预先交付 `contracts/test/Toolchain.t.sol` 用于本地链冒烟。
- [ ] 【AI 自动】`src/app/layout.tsx`、`src/app/providers.tsx`、`src/app/page.tsx`、`src/app/error.tsx`、`src/app/not-found.tsx` 与 `src/components/ui/**` 提供导航、Provider、首页、错误页与 404。`src/app/maintain/page.tsx` 先交付维护入口，渲染 `src/lib/maintain-navigation.ts` 的静态注册表，E3 后交给 `review`。TS 开 `strict`、`noUncheckedIndexedAccess`；`.gitattributes` 写 `* text=auto eol=lf`，`.npmrc` 固定 pnpm 本地项目约定。地基提供 `dev:webpack` 和 `build:webpack`，分别运行 `next dev --webpack`、`next build --webpack`。本地 Windows Turbopack 报错即改用 `pnpm dev:webpack` 或 `pnpm build:webpack` 复现，记入地基报告并保留 Vercel 常规构建。 [Next.js webpack 切换](https://nextjs.org/docs/pages/api-reference/turbopack#using-webpack-instead)
- [ ] 【AI 自动】`pnpm install --frozen-lockfile`、`pnpm verify`、`forge test --root contracts`、`pnpm e2e e2e/acceptance/home.spec.ts`。Vercel Preview 产出构建检查。
- [ ] 【AI 自动】`src/lib/maintain-navigation.ts` 固定「投稿待办」「审核投稿」「日记历史」「处理设置」「纪念日设置」「永久任务」「离线快照」及各自路径和交付开关。维护首页用该表渲染，各板块只实现其已登记页面，开启本块交付开关后即可在维护首页进入。E3 后 `review` 继续用此表渲染入口，`intake` 无需等 `memorial` 合并。
- [ ] 【人工·E2】在 Windows 用 `pnpm dev:webpack` 启动并打开本机「首页」，应返回 200，再用 `pnpm build:webpack` 核对退出码为 0，记录 Next.js 版本和命令。常规 Turbopack 如报错，保留脱敏错误摘要与 webpack 复验结果。

### 0.2 · 共享契约、数据库、授权与适配器（B.2、B.7）

- [ ] 【AI 自动】在 `src/lib/contracts/{intake,review,permanent,public,exports,jobs}.ts` 固定后文接口、Zod 输入和合成 fixture。`src/lib/adapters/` 为 Grok、Blob、Auth、归档与链分别提供接口、确定性的 Mock 和人工可切换的测试沙箱，选择器落 `src/lib/adapters/select.ts`，环境检查与 B.2 执行闸落 `src/lib/env.ts`、`src/lib/adapters/mainnet-gate.ts`。在服务入口和向外发送前均检查环境与执行闸。测试进程的 `CI=true` 选择器强制 Mock，未设置云端凭据也能运行；合成预览会话同样强制 Mock。
- [ ] 【AI 自动】在 `src/lib/policy/content.ts` 提供 `evaluateContentPolicy(input: ContentPolicyInput): ContentPermissions`，输出 `publicView`、`privateExport`、`arweave`、`nft` 四个布尔值。输入至少有当前版本、批准版本、发布、撤下、排除与用途授权。用表驱动测试冻结普通获准、草稿、旧版本、撤下、明确不上链且可导出、禁止导出、拒绝歧义、版本更换导致旧批准失效。所有读写入口复用此策略。明确排除对同一照片身份持续有效。
- [ ] 【AI 自动】写 `supabase/config.toml`、`supabase/migrations/`、`supabase/seed.sql`、`supabase/tests/**`、`e2e/fixtures/**`、`src/lib/database.types.ts`。建投稿、条目、照片/日记版本、发布/用途授权、站点设置、任务、执行凭证及当前 ZIP 引用，`jobs.sample_run_id` 标识合成运行，约束与状态见共享契约。所有业务表默认启用 RLS，显式授权，禁止 `USING (true)` 等兜底全开。两套网站和工作器运行角色各有独立连接，只能使用自己的 schema，互无角色成员关系，均无建库、建角色、表所有权或 `BYPASSRLS`。网站提供公开投影和经身份核验的维护操作，工作器仅领任务、读取执行所需数据及回写。把业务 schema 排除在 Supabase Data API 暴露范围外，`PUBLIC`、`anon`、`authenticated` 均不给业务 schema 的访问权。Auth 会话与业务连接分开。`pg` 查询以 `database.types.ts` 中 `Database['business']['Tables']` 的 `Row` 约束查询结果的 TS 类型，关键边界仍用 Zod 校验运行时结果。`src/lib/supabase/{client,server,admin}.ts` 分开使用，服务端两个文件首行 `import "server-only"`。`admin.ts` 是受保护的服务端边界，App、Preview、CI 测试和开发进程均无项目级高权限 key。
- [ ] 【AI 自动】在受保护的连接初始化中按 `VERCEL_ENV`（仅允许已定义环境）或工作器实例名匹配预期项目连接、`current_user`、`current_schema()`；核对失败拒绝提供业务读写或领任务。角色默认 `search_path` 只面向指定业务 schema 与系统目录，业务查询参数化。D1 验证实际池和角色：

| 调用者 | 连接方式与约束 |
| --- | --- |
| Vercel 网站 | 事务模式池，使用角色默认 `search_path`；不用会话级 `SET`、会话锁或命名预处理语句。 |
| Contabo 工作器 | 可达时用直连，否则用会话模式池；持有专用连接上的会话锁。 |
| GitHub 可信迁移、类型与体检 | 受限 SQL 连接走会话模式池；串行迁移使用按 schema 分键的事务锁。项目级 advisors 独立使用管理接口，权限见 0.7。 |

- [ ] 【AI 自动】`pnpm exec vitest run src/lib`、`pnpm verify`、`supabase test db`。测游客、维护者、合成样本和工作器的行与对象权限，错项目、错角色或错 schema 拒绝。用隔离本地库已有的业务样表验证跨 schema 读写拒绝为 SQLSTATE `42501`，并复核建表、`SET ROLE` 拒绝；D1/E2 用实际角色核对 grants，目标表不存在的结果不计权限通过。G2 用各环境实际运行角色对另一 schema 内已有的业务表双向复验拒绝，成功时也不读取该表数据。

### 0.3 · 主题、静态规则和 worktree（B.1–B.3、B.7）

- [ ] 【AI 自动】`src/app/globals.css` 用 `--color-*: initial;`、`--font-*: initial;` 清空默认色板和字体，仅用 `@theme inline` 映射 `background`、`foreground`、`primary`、`muted`、`border`、`accent` 等语义变量及 `--font-heading`，先填中性高对比度值。根 `DESIGN.md` 按手册 3.8，最多 40 行。根 `AGENTS.md` 项目规则按 3.1，祈使句且最多 65 行，保留 Next.js 管理区块。使用相应工具时 `CLAUDE.md`、`GEMINI.md` 只引用根规则。
- [ ] 【AI 自动】`.env.example` 按凭据配置清单列全变量、用途、落点，值留空；生产专用项不进入本机或 Preview 的允许清单，`env.ts` 仅解析当前进程落点声明的变量，板块只通过该模块取配置；`.gitignore` 含 `*.local`。`.ai/bin/setup-worktree.sh <worktree-dir> [env-file]` 验证基线及 D3 工具链，缺项按工具名退出。复制显式指定本机文件或服务器 `~/secrets/<项目名>.env.local` 为 worktree 的 `.env.local`，文件 `0600`，不回显或链接，随后 `pnpm install --frozen-lockfile`。环境校验仅报变量名，CI 模式无第三方业务凭据也能启动，Preview 禁用生产配置。
- [ ] 【AI 自动】`eslint.config.mjs` 用 ESLint v9 Flat Config、Next core-web-vitals + TypeScript，`noInlineConfig: true`，禁止显式 `any`、`@ts-ignore` 类注释；`@shadcn/lint` 四条为 `no-raw-colors`、`no-arbitrary-values`、`no-inline-styles`、`no-restyle`，提示「设计规则见 DESIGN.md」。误报无法解决时按 B.3 换 `eslint-plugin-better-tailwindcss` 并记录覆盖。仅 `e2e/**` 启用 Playwright `no-skipped-test`、`no-focused-test`、`expect-expect`。`pnpm test` 用 `vitest run --passWithNoTests`，`pnpm lint` 用 `eslint . --max-warnings 0`；`.secretlintrc.json` 使用 secretlint 推荐预设，`.secretlintignore` 按 B.3 忽略 `node_modules`、`.next`、`playwright-report`、`test-results`。错误提示写可执行修法。
- [ ] 【AI 自动】在受保护的 `vitest.config.ts` 与 `src/features/foundation/**` 测试 setup 拦截单测进程向非回环地址发起的 `fetch`、HTTP(S) 与 `net.connect`；Playwright 只从受保护 `e2e/support/` fixture 导入 `test`，浏览器请求限制为验证后的 `BASE_URL` 同源，阻止绕过拦截的 service worker，fixture 的 HTTP 请求也限同源。站内资产自托管。单测验证网络拒绝及 `CI=true` 强制 Mock。
- [ ] 【AI 自动】禁止 `test.fail`、`test.fixme`、`test.skip`、`test.describe.fixme` 等伪通过或跳过写法，禁止业务代码直接读 `CI`、`NODE_ENV` 并按此返回样本，环境判断由受保护模块承担。限制 `e2e/features/**` 直接引入 `@playwright/test` 或绕过公共 fixture。`pnpm secrets` 增加受保护的 `scripts/check-private-identifiers.mjs`，扫描受检的仓库文本中的邮箱和 `0x` 加 40 位十六进制地址。允许保留域的合成邮箱和少量已审定的公开上游或测试常量，例外精确到文件和字面值，真实站点身份、地址和猫名不进入扫描清单。命中只报路径和规则，不打印疑似私密值。
- [ ] 【AI 自动】`pnpm verify`、`pnpm secrets`、`bash -n .ai/bin/setup-worktree.sh`，用测试夹具运行 worktree 脚本，再在新目录执行 `pnpm verify`。`node scripts/check-stage0.mjs` 验变量落点与生产配置隔离。
- [ ] 【人工·D3】管理用户预备 Node 24、锁定的 pnpm、Git、`gh`、Foundry、Playwright Chromium 与 OS 依赖、`sharp` 使用的 HEVC/libvips 及地基所需的 Supabase CLI/本地数据库工具；记录实装版本。以 `agent` 冒烟核对版本和可执行性，HEVC 用 D1 的授权原件验证。缺项在开跑前补齐。
- [ ] 【人工·E3】启用受保护清单后演练行内豁免、硬编码颜色、跳测、绕过 fixture 及合成泄露样例均被拦截。

### 0.4 · 维护者登录与 `/debug`（B.2、B.7）

- [ ] 【AI 自动】`src/app/maintain/login/page.tsx`、`src/app/maintain/login/actions.ts`、`src/app/maintain/logout/route.ts` 和 `src/proxy.ts` 提供邮箱密码登录、服务端 Cookie 会话刷新、POST 登出；地基在 `src/lib/supabase/server.ts` 提供 `requireMaintainer()`。每次受保护读写在服务器核对项目签发的会话并匹配预建 UID；使用 Supabase SDK，后台敏感操作核验当前用户，Cookie 在 HTTPS 使用 Secure，受保护响应 `no-store`。登录与登出使用测试及正式各自 origin 下的 `/maintain/login`、`POST /maintain/logout`，邮箱密码通过 `signInWithPassword`，无第三方重定向回调或注册入口。重复登录仅更换浏览器的有效会话，不创建账号；登出清理 Cookie 并撤销当前 Supabase 刷新会话，重复登出同样回登录页。拦截跨站维护写入。注册、匿名登录、跨业务 schema 的 Data API 拒绝及真实会话按 D1.1 实测。
- [ ] 【AI 自动】`src/app/debug/**`、`src/app/api/debug/**` 只在 `VERCEL_ENV=preview` 或显式 `development` 开放，真实诊断须经应用维护者鉴权，合成样本路由只在自己的票据范围开放，缺环境、非对应身份或生产一律 404。`jobs` 表与「任务记录」只展示 ID、时间、状态、短原因，排除原邮件、附件、完整入参和凭据。`src/app/api/debug/samples/**` 仅在预览/本地启用 Mock，绑定服务器签发的样本 Cookie 和唯一 `runId`，只读写本轮合成样本，禁止访问真实测试稿件、Bot 权限、文件目录或链上适配器。CI 的 Vercel 放行头只用于进入平台。部署后端对每个读写校验样本范围，结束后只清理对应 `runId`。提供「样本登录」与仅测试使用的公开样本票据签发和读取校验，约束见 2.2。落盘 D1 探针 `scripts/d1-probe.mjs`。
- [ ] 【AI 自动】在 `src/app/api/debug/samples/schema/route.ts` 提供仅测试项目 `integration` Preview 可用的迁移验收探针。要求有效样本 Cookie/票据和本轮 `runId`，服务器用该部署自身的受限测试网站角色在固定样本范围写入、读回、清理一条合成记录。拒绝自选表、字段、环境或其他 `runId`；失败回滚或仅清理本轮。CI 仅持测试项目放行密钥并通过既有样本登录领取票据。
- [ ] 【AI 自动】`pnpm exec vitest run src/lib/supabase src/app/debug src/app/api/debug`、`pnpm e2e e2e/acceptance/home.spec.ts`。断言错误密码失败、刷新后会话仍在、登出后匿名受限、不同 `runId` 隔离、生产和未识别环境 404、放行密钥不能单独授权样本探针。
- [ ] 【人工·E2/G2】E2 预览确认无「注册」，测试账号登录刷新后可读维护页；点「退出登录」后被转回登录，旧刷新令牌失效。生产账号在测试预览被拒，G2 用测试账号在正式环境复验反向拒绝。账号资料和会话令牌私下处理。

### 0.5 · 最小真实投稿样板（B.2、B.4）

- [ ] 【AI 自动】`src/app/api/debug/intake/{prepare,submit}/route.ts`、`src/features/foundation/**` 和 `.ai/bin/systemd/memorial-worker@.service` 交付预览专用最小入库和可复用工作器入口。样板固定入口是 `TEST_CALLBACK_ORIGIN` 下的 `/api/debug/intake/prepare`、`/api/debug/intake/submit`，测试 Grok 专用 Bearer 验证、上传边界和去重同 1.1。它是单独的测试交稿入口，先做 `VERCEL_ENV` 校验及专有交稿鉴权，任何任务读取仍经维护者鉴权。Contabo 从测试库主动领取并从测试 Blob 拉取。【人工·F2】板块 1 合并且全量 e2e 通过后，按 D1 的配置把测试 Grok 切到 1.1，再移除样板专用令牌。
- [ ] 【AI 自动】样板串联「查看样本」、持久化、任务编号、文件哈希、重投去重及短失败原因。受保护的真实工作器领任务 SQL 固定筛 `sample_run_id IS NULL`，合成任务由预览应用在本轮 `runId` 内同步用 Mock 完成。按 schema 派生 `memorial-worker:<schema>` 会话锁；连接丢失先停领、停发，恢复后核对在途任务。测试和生产实例均由系统级 systemd 用 `agent` 运行、主动出站，角色与文件目录分开。
- [ ] 【AI 自动】交付受保护 `.ai/bin/deploy-worker.sh <test|prod> <SHA>`、`.ai/bin/systemd/memorial-worker-deploy-test.{service,timer}` 与上面的工作器模板。测试部署计时器在 Contabo 只读查询 0.7 的可信成功状态，只有可信 `main` 工作流运行及工件证明 `integration-schema` 已通过的完整 `integration` 合并 SHA 才部署，E2 引导基线同样须有状态。预备独立版本目录、锁文件依赖安装和启动前检查，安装不以 root 执行；停止领新任务并有界等待在途任务落到可恢复边界，再原子切换 `current` 并重启。超时不切换，失败恢复兼容旧版或停发，并告警。G2 由维护者发布生产工作器代码，迁移先于切换，生产部署路径及执行入口由管理员控制。合约仍由 3.1 的受信发布记录自动排队。
- [ ] 【AI 自动】`src/features/foundation/**` 提供告警适配器及 Mock，工作器按自身定时检查磁盘、Turbo 余额和约定阈值，启用 intake 后在同一低频巡检中核对本地孤儿文件，复用现有告警。测试默认 Mock；D1 在有限次数的演练中验证真实通知，G2 复核正式服务。
- [ ] 【AI 自动】`pnpm exec vitest run src/features/foundation src/app/api/debug/intake`、`pnpm e2e e2e/acceptance/home.spec.ts`、`bash -n .ai/bin/deploy-worker.sh`、`systemd-analyze verify .ai/bin/systemd/memorial-worker@.service .ai/bin/systemd/memorial-worker-deploy-test.service .ai/bin/systemd/memorial-worker-deploy-test.timer`。测重复事件、坏件、`runId` 不被真实队列领取、测试和生产能各持锁而同 schema 第二实例拒绝、错 SHA 不部署及模拟阈值告警。
- [ ] 【人工·E2/E3】维护者安装测试模板和计时器、验证版本与同 SHA 状态一致。E3 按预览验收做真实测试投递、重投和工作器重启，记录任务不重复。

### 0.6 · 锁验收、快检与可信守卫（B.2–B.5）

- [ ] 【AI 自动】地基交付 `playwright.config.ts`、`e2e/support/{assert-page,check-delivered}.ts`、`e2e/acceptance/{home,intake,memorial,permanent,exports}.spec.ts` 与清单中五个 ID 的 `e2e/acceptance/delivered/<ID>.json`，初始均为 `{"delivered": false}`。首页健康始终执行，另以 `foundation` 开关控制同 spec 的地基样板断言，地基最终提交仅打开 `foundation.json`，E2/E3 在其上再手工证明真实测试链路。每业务板块交付只把本块设为 `true`。按 `BASE_URL` 使用预览，否则本地自动启动；桌面 1440×900 和手机 390×844，CI 重试一次，HTML+JSON、失败 trace。公共断言含未捕获错误、`scrollWidth <= innerWidth`、WCAG 2A/2AA 的 serious/critical axe；整页截图仅进报告。自动检查 JSON 两端已开启 spec 均有通过、零跳过，输出 SHA、板块、数量、截图及 axe 结果。
- [ ] 【AI 自动】`stage0/github/protected-paths.txt` 逐条纳入 B.2 全部正则，再加 `docs/modules.json`、`.env.example`、`.gitignore`、适配器与选择器、`src/lib/contracts/`、`src/lib/policy/`、`src/lib/env.ts`、地基 Auth、部署脚本和单元、测试网络闸和私密标识扫描、合约公共工具链、阶段性 `stage0/github/` 等地基路径。保护清单涵盖仓库规则、应用外壳公共项、工作流、安全闸、共享脚本和测试输入。迁移仅按 0.7 的新增例外放行。交付开关只允对应板块 `false` → `true`；无标签豁免，已开开关不能关闭，禁止增删、改名或伪造 JSON。
- [ ] 【AI 自动】`stage0/github/workflows/{ci,guard}.yml`。`ci.yml` 用 `pull_request` 检出受检 PR 头，装锁定依赖，复用 Playwright 与 Foundry 版本化缓存，限制 CI/e2e 并发且不取消 `integration` 每个合并 SHA 的验收，跑 `pnpm verify`、`pnpm secrets` 和 `forge test --root contracts`。`guard.yml` 用 `pull_request_target`，在目标分支以 `contents: read` 判定，取 PR 精确 SHA，只读变更状态、路径、开关 JSON、本次 ID 和目标分支保护清单。重命名按删除加新增判，拒绝受保护路径的重命名及链接。判定任务不执行 PR 文件。单独的目标分支状态发布 job 只取判定结论与头 SHA，用 `statuses: write` 发布 `guard`；其它 PR 执行作业无状态写权限。这一具名结果还须经 Cezar 核对工作流、来源及提交号，缺任何一项即不合。试装或地基更新由维护者按手册核对后管理员放行。
- [ ] 【AI 自动】用目标分支上的 `foundation.json` 判定交接，PR 内容不能改变所属阶段。置 `true` 前只有 `stage-0` 能为地基创建共有产物。置 `true` 后 `src/app/page.tsx`、`src/app/maintain/page.tsx` 仅归 `memorial`，四个 `jobs.ts` 分别归 `intake`、`memorial` 中的 `review`、`permanent`、`exports`。此后业务迁移命名与交付开关按本板块限定，地基广义 glob 不给返修通行权；共有改动仍走维护者已授权的地基修复。E3 前不派发业务板块。
- [ ] 【AI 自动】`report/<日期>` 指向 `integration` 时只准新增或更新一个普通文件 `docs/run-report.md`，拒绝删除、改名、链接和混改；`skin/*` 仍按 0.6 与 G1 既有试装规则。可信 guard 拒绝删除已入库的功能 spec；变更用例本身由 PR 审查对照验收覆盖。必要的测试重构由维护者显式审核放行。板块私有 fixture 放 `e2e/features/<ID>/fixtures/**` 或 `src/features/<ID>/**`，共享 fixture 仍保护。
- [ ] 【AI 自动】`actionlint`、`pnpm e2e e2e/acceptance`、`pnpm exec tsx e2e/support/check-delivered.ts`、`pnpm exec vitest run e2e/support`。守卫用固定夹具覆盖阶段所有权、报告路径、删除已有 spec 和跨板块修改。
- [ ] 【人工·E3】用假绿灯、开关删除或关闭、锁定 spec 改动、改坏或删 guard 演练。验证交接后 `fix/foundation-N` 改首页被拒，归属 `memorial` 的同一路径变更通过所有权检查。

### 0.7 · 测试库迁移、可信触发和类型同步（B.5、B.7）

- [ ] 【AI 自动】**首次地基迁移**　地基把 `migrate.yml`、`db-advisors.yml` 和迁移、类型脚本暂存于 `stage0/github/`。【人工·E2】维护者先把 `migrate.yml` 与其依赖的可信脚本装上默认分支 `main`，再同步 `stage-0` 并安装其余文件。在 Actions 打开 `migrate.yml` → Run workflow → Branch `main`，选择 `bootstrap-test`，`ref` 填已确认的地基 PR 当前完整 40 位 SHA。只允许维护者手动触发，核对目标为 `main`、输入对应地基 PR 当前审核版本、共用项目与测试 schema 固定匹配。由 `main` 的可信代码读取该 SHA 的迁移、测试 seed 和类型，以测试 schema 的迁移角色执行。测试 seed 可重跑。对比类型、核对 RLS 和角色权限，并由分开的管理作业跑体检。变更迁移后重新确认 PR SHA。
- [ ] 【AI 自动】**板块迁移的合入条件**　每块仅能追加 `YYYYMMDDHHMMSS_<ID>_<描述>.sql`。可信守卫核对任务 ID、路径、普通文件模式、只新增与14 位 UTC 时间戳格式正确且在全仓唯一，保护已有迁移、seed、CLI 配置和类型文件。审查须确认只增加兼容结构、显式 grants 及 RLS。迁移 SQL 以当前业务 schema 为目标，不写死物理 schema，可使用可信脚本提供的 `:"web_role"`、`:"worker_role"`。禁止跨 schema 限定名、动态 SQL、变更角色或搜索路径、破坏性 DDL 和事务控制。PR 在本地一次性 Supabase 重放并验证。Vercel 使用仓库的已提交类型，新板块私有表在 F2 同步前可用本板块的参数化服务端查询与 Zod 行契约。共用表与类型由地基预建。
- [ ] 【AI 自动】**可信自动触发**　地基暂存 `stage0/github/workflows/integration-merged.yml` 和 `stage0/github/workflows/migrate-integration.yml`，E2 维护者安装到位。前者只在 `integration` 的 `push` 发成功信号，无密钥且不执行板块代码。默认分支 `main` 上的后者用 `workflow_run: completed`，先在无密钥 job 核验工作流 ID/路径、`push`、成功结果、仓库和分支，核对合并 SHA 在 `origin/integration` 第一父链、对应 PR 已由规则集 squash，及其审核 SHA 与可信 `guard` 等检查和合并记录。随后按第一父链和台账处理尚未完成的 SHA。输入 SQL 仅从已核验的 Git 对象读取，管理 job 只执行 `main` 的工作流和脚本。重复信号先对账，按 schema 派生 `memorial-migrate:<schema>` 键，用 `pg_advisory_xact_lock` 串行提交。拿锁后重新读取台账，将待处理合并 SHA 和该 SHA 的迁移文件按可信第一父链顺序对账，已成功的项不重跑。
- [ ] 【AI 自动】**数据库强制隔离**　`main` 的 `.github/scripts/migrate-schema.mjs` 只从预设环境选 schema 与角色。自动作业通过限定 `main` 的 `db-admin` 取得独立 `test_migrator` 连接，不取项目所有者密码或 `service_role`。D1 由维护者授予该角色仅测试 schema 内建表和管理其所建对象的权限。无生产 schema 的 USAGE/CREATE、生产对象的 grants、生产角色成员资格、DB CREATE、CREATEROLE 或 BYPASSRLS，复核继承自 `PUBLIC` 的授权。生产用独立 `prod_migrator` 及仅 `main` 的 `prod-db-admin`，当套餐支持时启用维护者 Required reviewers；D1 核验可用性及自审限制。无可用环境审批时仍须由维护者从受保护 `main` 手动发起，可信脚本核对发起身份和已审核 SHA，自动作业不得引用生产环境或等同凭据。连接后先核对项目、`current_user`、目标 schema 和拒绝清单，失败则退出。每个迁移在事务中以固定 `search_path` 应用，同时在目标 schema 的独立台账记文件名及 SHA-256，先应用的文件若校验值有变即失败。共享项目禁止使用默认全库 `supabase db push`、`db reset` 或共用迁移台账。
- [ ] 【AI 自动】**类型、权限和放行**　先由可信 `main` 逻辑在无云密钥的本地 Supabase 重放审定迁移，准备预期类型。实际执行后，以受限连接仅从目标 schema 生成类型，`.github/scripts/schema-types.mjs` 将两环境的 schema 类型键规范为 `business` 后逐字节对比。另一个限定 `main` 的 `db-admin` 作业只运行可信体检命令。项目级体检令牌能看到共用项目，禁止向此作业传板块 SQL 或执行板块代码。类型、权限断言与体检都通过才发布同一 SHA 的 `integration-schema` 成功状态及类型工件，工件附 SHA、迁移清单、校验值。未追加迁移的合并也得到自己的状态。合并 SHA 的完整预览 e2e 等待该状态，失败留记录，Cezar 按 3.5.3 有界等待并只为同一失败 SHA 派一次返修。
- [ ] 【AI 自动】可信迁移脚本通过系统目录和有效权限断言目标业务 schema：常规及分区业务表启用 RLS，无无条件放行策略；`PUBLIC`、`anon`、`authenticated` 无业务授权，运行角色非表所有者、无 `BYPASSRLS`，亦无法经成员关系取得这些权限。项目级 advisors 作补充。`check-stage0.mjs` 静态验证自动测试迁移工作流不引用 `prod-db-admin` / `SUPABASE_ACCESS_TOKEN`。
- [ ] 【AI 自动】**同步受保护类型与失败处理**　每次测试迁移先留经比对的类型工件，普通板块 PR 无权改 `src/lib/database.types.ts`。【人工·F2】维护者取最新全绿 `integration` 的工件，对照迁移台账和哈希，在 `fix/foundation-1`（后续递增）仅同步该文件，按附录 B 由维护者审查、放行并重跑新 SHA 检查。【人工·维护窗口】若回滚后确认失败文件从未在任何共享 schema 应用，由维护者在下一工作窗口审核单独地基修复及重新取证；已应用迁移只能追加修复。失败的通知注明合并 SHA、迁移文件名及其中的板块 ID。失败迁移暂停共享迁移队列和依赖板块的合入，无关板块继续实现和自测。夜间不提升权限、跳过台账或要求临时决定。
- [ ] 【人工·E2/G2】**生产手动与手册修订**　G2 维护者从 `main` 手动触发 `migrate.yml` 的 `production` 模式，填已审核且测试、类型全绿的待发布 SHA，只用生产 schema 迁移角色和独立台账，运行前核对仓库类型与该 SHA 的类型证据，生产无测试 seed 和自动派发。后续板块迁移自动应用到测试 schema，属于手册 B.5 的偏离。E2 交接时登记需同步修订 B.2/B.5/B.7、3.1 和相关 E/F 步骤，同步共用项目、受限角色、首次和生产迁移仅手动、工作器系统级单元和发布脚本。另登记 D3 对 3.5 的节点/等待修订及 G2 首版恢复范围例外。
- [ ] 【AI 自动】`actionlint`、`supabase db reset --local`、`supabase test db`、`supabase gen types typescript --local --schema memorial_test`。可信迁移调用 `node .github/scripts/migrate-schema.mjs` 校验范围、权限及台账，并以 `supabase gen types typescript --db-url "$SCHEMA_DATABASE_URL" --schema "$BUSINESS_SCHEMA"` 和 `node .github/scripts/schema-types.mjs` 比对类型。`db-advisors.yml` 定时（UTC 22:00）、手动或由可信迁移作业调用，限 `main` 的 `db-admin` 使用 `supabase db advisors --linked --project-ref "$SUPABASE_PROJECT_REF" --type security --fail-on error`。
- [ ] 【人工·E2/E3】E2 维护者手动触发首次迁移并核对类型与权限。E3 在测试 schema 短时创建隔离的漏 RLS 样表，验证可信 SQL 断言报错并清理。用两个带新迁移的演练 PR（文件时间戳排序与合并相反）、重复信号和错误来源验证按合并顺序各应用一次、错误来源被拒、生产 schema 和台账无变化，两次合并 SHA 各有对应类型工件和全量 e2e 报告。用本地越界 SQL 复现权限拒绝，保存脱敏断言和 SQLSTATE。

本地重放时，`supabase db reset --local --no-seed --workdir "$LOCAL_SUPABASE_DIR"` 只初始化一次性工作目录的空库，目录放配置及角色夹具，由 `node .github/scripts/migrate-schema.mjs --target local` 按可信合并清单重放已合迁移，再追加当前 PR 新迁移；同一合并内多文件按文件名稳定排序，跨合并按第一父链与台账顺序，禁止按全局文件名排序替代。可信脚本只替换固定的角色标识符，经数据库驱动提交 SQL，拒绝客户端元命令。E2 首次创建 `integration` 时，可信工作流用 `main` 的手动迁移记录、已审核地基 PR 和该分支起点核对测试状态，为引导 SHA 发布 `integration-schema`。F2 同步类型允许维护者按附录 B 管理员放行。工作流仅在可信记录证实由维护者合并、唯一变更是数据库类型且内容匹配最新全绿工件时接受该合并。其余地基改动须由维护者在约定的地基修复窗口复验，普通板块没有豁免。

### 0.8 · 预览全量 e2e 与生产只读（B.4、B.5）

- [ ] 【AI 自动】`stage0/github/workflows/e2e.yml` 处理 Vercel `deployment_status` 成功事件，按 E2 实测的项目标识及环境名筛选测试项目 Preview，配置用 Actions Variables。检出 `github.event.deployment.sha`，从可信部署记录取 `BASE_URL` 并验证与测试项目、该 SHA 绑定的 HTTPS 部署 origin，拒绝生产 origin、分支别名和上一次部署。受保护 fixture 拦截跨 origin 请求。PR 只跑已启用的验收及有板块 ID 时对应的功能测试，用 Mock 和当前提交的合成样本。`integration` 每个合并 SHA 跑全量 `pnpm e2e`，等同 SHA `integration-schema` 成功后先调用 0.4 合成探针写、读、清理，随后验收；CI 不持数据库连接。先部署时有界等候，失败/超时记录并只建一次该 SHA 的返修，下游等待。以部署 SHA 报告 `e2e`；需桥接时由可信默认分支作业核对部署、运行、结论和 SHA 后发布。测试 job 无状态写权限，仅必要步骤注入测试项目平台放行密钥。
- [ ] 【人工·E2/E3】E2 取真实 `deployment_status` 的脱敏样本，确认事件环境名、项目标识和部署 SHA 的对应，记录现场结果后再定精确筛选条件。用临时分支核对正式项目不出可用 Preview 或必过检查；E3 演练伪项目标识、生产域名、旧提交和跨域响应均被拒，并核对测试 `e2e` 是同 SHA 的必过检查。
- [ ] 【AI 自动】`stage0/github/workflows/prod-readonly.yml` 由维护者在 G2 启用，只请求正式域名的首页、`/debug` 及私密入口，验证 200、404 和访客拒绝。定时及发布后运行，失败只通知维护者。该作业不携带测试样本写权限或数据库管理凭据，生产部署事件不触发预览写测试。
- [ ] 【AI 自动】**自动检查**　`actionlint`、`pnpm exec playwright install --with-deps chromium`、`pnpm e2e`、`pnpm exec tsx e2e/support/check-delivered.ts`。上传两端 HTML/JSON、截图、axe 和失败 trace，核对报告的部署 SHA。生产只读工作流运行 `node scripts/prod-readonly.mjs`，按约定状态码失败并通知。

### 0.9 · 规则集、交接与两道门（B.1–B.7）

- [ ] 【AI 自动】地基执行者写 `docs/decisions/foundation.md` 和 `docs/stage0-report.md`；报告列文件、偏差、待实测项、E2/E3 网页点选顺序及每项产物和证据。D2 管理员启用 `main-lock`，机器账号获 Write 前验证 `production-lock` 限创建、更新、删除并仅管理员绕过。仓库公开，D1 核对当前 GitHub 规则集及 Environment 能力。Settings → General 开 Allow auto-merge、Squash、Merge commit。E2 按门一步骤先装迁移，再以管理员安装其余工作流、合入 `stage-0` 并切 `integration`。第一次地基 PR 正在引入受保护项，可信 guard 如未安装或命中，记录缺失或红灯，按 B.5 由维护者审核后放行此次地基 PR。E3 开 `integration` 规则集，要求 PR、审批数 0、只允许 squash、禁止删除和强推；`main-lock` 保留仅管理员更新，禁止删除强推、仅允许 merge commit。两者都配置具名 `verify`、`guard`、`e2e`、指定测试 Vercel 项目的部署检查，核对来源，关 strict，唯管理员可绕过。G2 切生产项目到 `main` 后撤临时锁。
- [ ] 【AI 自动】**自动检查**　地基交付 `scripts/check-stage0.mjs` 校验暂存清单、规则契约、依赖、受保护路径和开关。E2/E3 运行 `node scripts/check-stage0.mjs`、`gh pr checks <PR>`、`gh ruleset check main`、`gh ruleset check integration`、`gh ruleset check production` 并留输出，Vercel 查测试项目和部署 SHA，服务器 `git fetch origin --prune` 后按 E2 新 worktree 命令复核。维护者对照下表在 `docs/field-notes.md` 记录 SHA、规则集状态、报告链接及演练结果。遗留故障按开跑前门禁停在相应阶段，夜间不临时修改护栏。

| 护栏 | 谁安装 | E2 / E3 如何证明 |
| --- | --- | --- |
| B.1 共用文件、伪绿、熔断、环境、数据泄露五类风险 | 地基落实 0.1–0.8；D3 执行器作者装代决、三次上限、重启恢复 | E3 红灯 PR 不能合；锁定测试与禁用注释无法绕过；第三次失败留草稿并释放名额；未授权命令拒绝或超时；测试库漏 RLS 报错，临时表清理后恢复。 |
| B.2 分支、目录、受保护清单、样板、主题、数据与安全闸 | 地基交付；维护者 E2 安装工作流并初始化测试库，D2/E3 装分支规则 | E2 核对 `AGENTS.md`、`DESIGN.md`、布局、字体插座、`.env.example`、worktree 脚本和全部受保护产物；测匿名、维护者和样本的 `/debug`；E3 验无闸主网适配器拒绝且真实 Grok 样板可持久化、重投去重。 |
| B.3 `pnpm verify`、lint、密钥扫描 | 地基装配置与命令 | E2 本地和 PR 同 SHA 全绿；E3 故意放 `any`、行内屏蔽、硬编码颜色、跳测或假密钥，分别产生可修复红灯；新 worktree 一次 `pnpm verify` 通过。 |
| B.4 锁验收与交付开关 | 地基预建五套、锁 spec 与基础断言 | E2 首页始终可跑且双视口报告齐；E3 用临时测试开关、伪造报告演练规则，已开启的 spec 两端确有通过且零跳过，改锁定测试、删除开关或关闭已交付开关被拒。 |
| B.5 快检、可信 guard、部署验收、迁移、体检、正式只读 | 地基写工作流；E2 维护者在受控分支安装并手动触发首次迁移，G2 安装正式监控 | E2 核对相同 PR SHA、首次迁移与类型体检；E3 删除或改坏 guard 仍拒绝合并，提交变化旧绿灯作废，绑定 SHA 合并；两条好 PR 顺序合并，各自部署 SHA 都跑全量 e2e；测试迁移无须现场操作，生产部署信号不写样本。 |
| B.6 GitHub / Vercel 设置 | 维护者按 `docs/stage0-report.md` 点选；地基提供检查 | E3 机器账号直接推 `main`、`integration` 或创建 `production` 均被拒，目标 `main` 的全绿 PR 也不能由机器账号合；测试项目才出必过 Vercel 检查，测试和生产配置可分辨。 |
| B.7 密钥分层与测试身份 | 维护者按 D1、G2 配置；地基实现环境与 `server-only` 边界，D3 执行器作者配置开发沙箱 | E2 扫描前端包和日志，核对仓库级敏感值仅测试放行密钥，管理和迁移 Environment 限 `main`。E3 验证仅平台放行头不能读私有资源、Mock 身份不能越界，测试运行及迁移角色拒绝跨 schema。D3/E3/G2 按凭据清单验证同 `agent` 的部署和开发进程边界，G2 核对已实际验证的生产凭据与执行闸访问结果，钱包文件按已批准例外保留可读，核对 `0700`/`0600` 权限。 |

【人工·D3/E3】D3 用桩验证 `wait-merged.sh` 仅 `MERGED` 通过，落后可继续等待，实际冲突、阻止合并或超时按手册收口，并保留当前头 SHA 的审核与合并约束。E3 另按手册 3.5.5 第二组验证审查拒绝时不合并、同步分支前撤自动合并、CI 等候中重启能继续按原 SHA 对账、总报告失败仍有夜间摘要。B.8 的后续增强不进入地基，截图仅供目检贯穿首版。

## 板块 1 · `intake` 投稿整理

**范围与可写路径**　`src/features/intake/**`、`src/app/api/intake/**`、`src/app/maintain/intake/**` 及本块的测试、决定、交付开关和新增迁移。交付 Grok 接入、原图保存、日期与拒绝指示解析、补件和私有投稿待办。依赖地基的文件、会话、队列及共享类型。

**禁碰**　「交付顺序与检查约定」中的共同禁区适用。禁止改地基 `/debug`、认证、策略、类型与既有迁移，禁止改审核发布、公开站、永久动作、ZIP 的私有路径。

**预览验收**

1. 在预览点「维护后台」→「样本登录」→「投稿待办」。用「投递样本」提交一封含三张原图和一篇日记的合成信，其中一张为 HEIC。重按「重投同一事件」，草稿仍只有一条、附件未重复。打开草稿，指定逐图日期覆盖共同日期，未备注的新投稿用北京时间收件日。冲突项显示「日期待确认」，HEIC 原件保留，预览衍生图为 JPEG。
2. 选择「损坏附件」样本投递，只有单件进入「附件待补」，其余合规条目仍在。选择「红色背景有多个候选」样本投递，对应照片显示「排除范围待确认」，公开路径均不出现这些图。选「无权限来源」样本触发坏令牌或非白名单，显示拒绝且不入库。在测试样本配置中选择「移除样本白名单」，刷新后尚未授权的投稿显示「授权暂停」。隐身窗口打开同一稿件 URL，被要求登录，附件无访问权限。
3. 【人工·F2】在固定 `integration` 预览用 D1 的 Grok 再投一次三张真实大小授权原图。确认「待审核」和实际文件大小；自动审批关闭时没有公开条目，也不创建已批准的永久动作。

### 1.1 · 固定交稿入口、认证和去重

- [ ] 【人工·D1／AI 自动】白名单仅存规范化邮箱的 SHA-256 摘要。D1 由维护者隐藏输入，在内存用应用同一套 `trim`、小写规范化计算，只输出并录入摘要。交稿时按同规则比较，稿件留摘要和来源标记。真实首个白名单邮箱不写入任何文件、日志、测试或导出；开发和 CI 只用合成身份。
- [ ] 【AI 自动】`src/app/api/intake/{prepare,submit}/route.ts` 的固定回调是 `https://<integration-测试别名>/api/intake/prepare`、`/api/intake/submit` 和 `https://<正式域名>/api/intake/prepare`、`/api/intake/submit`，在 E2 核对测试分支的实际 origin 后写入私下配置，生产 origin 待生产准备就绪后填写。 首次 Preview 和 Mock 验收允许缺少测试 origin。真实回调在别名核对并录入后启用，缺失时拒绝签发上传授权。仅接 HTTPS POST。Grok 出示环境专用 `Authorization: Bearer` 长期令牌，服务器恒时比较对应令牌并检查内容类型、请求大小与 schema。这里验的是 Bot 凭据，Grok 目前没有可由网站验签的发件人证据或独立消息签名。网站另以自报发件人核对白名单。私有稿件保存可追溯的发件标识和来源证据，真实白名单邮箱不得由日志、证据导出或样本写入文件。错误令牌 401，非白名单 403，不产生稿件和签名链接。令牌不得进提示词、响应或日志。Preview 平台放行另按 D1 配置，它仅允许请求到达应用。上传完成以 Grok 的 `submit` 及 Contabo 拉取校验为准。
- [ ] 【AI 自动】`src/features/intake/receive.ts` 使用 `IntakeEventV1` 与共享文件引用。去重唯一键为 `(环境, botSource, eventId)`，附件条目按 `(submissionId, kind, SHA-256)` 去重，日记用规范化正文哈希。`prepare` 用 `(环境, botSource, eventId, position, sha256)` 复用尚有效的对象分配，绑定只写的归属和时限。`submit` 的重复投递返回原投稿 ID，原事件的合法补件只附加缺少条目；元数据冲突有短原因。去重、附加及排队由约束和事务保护。可选 `sourceMessageId`、`sourceProof` 仅供追查。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/intake src/app/api/intake`、`pnpm e2e e2e/features/intake`、`pnpm verify`。覆盖错令牌、跨环境令牌、非白名单、重投与并发、重复附件、补件以及冲突内容不会覆盖原稿。

### 1.2 · 手机原图、直传和保留

- [ ] 【AI 自动】`src/features/intake/files.ts` 用 `PrepareUploadV1` 为每个原件分配服务器生成的测试或生产私有 Blob 对象键。`prepare` 和 `submit` 是 ≤256 KiB 的元数据 JSON，单图上限 100 MiB，超大信按条目分批。短期凭证默认有效 15 分钟，绑定一个新对象、PUT、MIME 及最大字节数，禁止覆盖。Grok 拿到凭证后直接上传原件，网站函数只处理元数据。Contabo 仅从绑定存储和对象键主动拉取，流式核对实际字节数、SHA-256、文件头、尺寸。按下步持久化文件和数据库引用后清除 Blob 暂存件，凭证到期再检查并清理迟到或未提交对象。对仍获准单图核对的素材，工作器按需用新暂存对象，经维护鉴权与文件授权签发 ≤60 秒的绕缓存读链接。明确不上链的照片不签发单图读取链接。保留 HEIC 原始格式，JPEG 在 Contabo 生成。展示图清除 EXIF、定位和设备等元数据，校正方向，独立存入 Blob。
- [ ] 【AI 自动】按 Bot 和固定窗口限制请求，按事件限制条目数及总字节，并对待拉取暂存字节分配设环境总上限。校验完成后、签发前在事务内保留额度，重试复用原分配，清理或回收后释放；达到上限返回 429 和短原因，保留可重试的技术待办。阈值由 D1 按 D1.2 的额度实测设定，单图、请求体限制继续生效，审批次数与有效期不受这些上传限制影响。
- [ ] 【AI 自动】在目标盘写临时文件并 `fsync`，核对哈希后同盘原子改名并同步目录，再提交数据库引用。按确定性文件标识重跑，已有文件先核验再补回引用。工作器复用 0.5 的巡检，已落盘超过 24 小时且无引用的文件列入告警，保留原件；数据库引用确认后才回收 Blob 暂存。
- [ ] 【AI 自动】只在授权、证据与附件引用核对并持久化后标记原邮件可清理。已完成原邮件可按 30 天默认保留期清理，缺件或争议保留证据，使用者主动清理原邮件也须以该标记为先。获准留存的原件保存在相应 Contabo 目录。退稿或撤回先限制访问，再按保留期或已确认的清理请求执行。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/intake`、`pnpm e2e e2e/features/intake`。用 Mock 同时测超过 4.5 MB 的原图和超出 100 MiB 的元数据拒绝、超期凭证、错误哈希、暂存并发超额与幂等保留、Blob 孤儿清理、落盘后写库前崩溃、超期磁盘孤儿只告警，以及去元数据。

### 1.3 · 日期、排除和补件

- [ ] 【AI 自动】`src/features/intake/normalize.ts` 对逐图、逐篇采用明确的本项日期 → 明确为全信共同日期 → 北京时间收件日。Grok 只提交建议、位置和原句，站点按可复现的日历规则验证。日期模糊或矛盾保留原句、暂停该项排序、生成「日期待确认」。排除优先匹配附件编号或描述，候选不唯一冻结候选，范围不明则冻结该封相应动作。同一原件 SHA-256 复用照片身份，疑似同图且指纹不同进入「排除范围待确认」，归授权不明。明确排除绑定照片身份并继承重投与版本，状态不可逆转为允许。素材需授权才可用于站外识别，失败或授权不明留待办，人工确认优先。白名单移除暂停未授权稿件，补件继续关联原稿且保留证据，不自行发信。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/intake`、`pnpm e2e e2e/features/intake`、`pnpm e2e e2e/acceptance/intake.spec.ts`、`pnpm verify`。覆盖逐项/共同/收件日、北京时间跨日、歧义范围、重投继承排除及白名单移除。交付时只开启 `intake.json`。

## 板块 2 · `memorial` 维护、发布与公开站

**范围与可写路径**　`review` 可写 `src/features/review/**`、`src/app/maintain/page.tsx`、`src/app/maintain/review/**`、`src/app/maintain/settings/**`。`public` 可写 `src/features/public/**`、`src/app/page.tsx`、`src/app/timeline/**`、`src/app/photos/**`、`src/app/diaries/**`、`src/app/api/media/**`。共用 `memorial` 的额外路径和一个交付开关。范围含审核、撤下、历史、开关、纪念设置与公开读面，永久执行由板块 3 管。

**禁碰**　共同禁区适用；禁止改地基登录/诊断、`intake`、`permanent`、`exports` 的功能与路由。G1 试装只改 `public` 所属路径，禁止改 `review` 和受保护的全局主题、根布局及 `DESIGN.md`。

**预览验收**

1. 打开预览「维护后台」→「样本登录」→「审核投稿」，打开该轮的合成稿，逐图勾选「站内发布」「Arweave 归档」「铸造并空投」，点一次「确认审核」。复制「打开公开样本」的地址，在隐身窗口打开并从「首页」点「时间线」，看到已获准照片及最新日记，此时永久任务可仍处「排队」。标记不上链的照片通过首页、时间线、照片页、相关 API 和此前站方媒体链接均不可读。
2. 在「日记历史」打开旧修订，点「恢复为新修订」并确认；匿名读者只见当下修订，历史仍可在后台查看。在审核详情点「撤下」并确认，再刷新隐身页及原媒体链接，内容消失、媒体返回 404；后台未发的动作暂停，已有凭证仍可查。
3. 打开「纪念日设置」，清空日期后首页显示平日内容。填合成日期及纪念文字，点「保存设置」与「纪念日预览」，看到配置的「纪念日」及文字，时间线导航可继续打开。在测试时钟跨北京时间零点，首页按已设日期切换并在次日恢复。
4. 打开「处理设置」，核对三个开关均默认关。单开「自动审批」，读到「发件人可能被冒充」提示并确认，合规样本被审批；另两个开关保持关，未发起真实写入或主网交易。加入拒绝、授权不明或改收款地址的合成信，只有相应动作进入需处理；再次关闭自动审批，新稿回到逐封确认。

### 2.1 · 单维护者后台与受审快照

- [ ] 【AI 自动】`src/features/review/approve.ts` 实现 `approveSubmission(input: ReviewDecision): Promise<ApprovalSnapshot[]>`，校验维护者、素材当前版本、白名单、用途授权和接收配置；同封可一次提交多项选择，站内公开可先完成，归档与铸造分别准入。NFT 须具归档许可且等待归档得到确认。拒绝授权或他人画面未获许可则挂起相关素材。裁剪可人工核准为新版本，自动处理不改变画面内容或自动打码。快照记录版本、操作、时间、人工或自动来源，用唯一键保证重复提交不重复发任务。
- [ ] 【AI 自动】`src/features/review/settings.ts` 独立保存三个开关，默认 false，记录开关变更及风险确认时间，启用自动审批后触发同一审批校验。操作结果未知等五类状态单独列明，不设日限和到期。审核列表含「审核投稿」「日记历史」「处理设置」，列待审核、处理中、完成、需核对及短原因，撤回与逾 24 小时结果未知的记录优先。隐藏私有照片于公开页，授权允许的当前版本仍在私有数据库和导出路径。
- [ ] 【AI 自动】接收地址仅存各环境数据库的私有站点设置，由维护者鉴权录入，记录 `recipientConfigVersion`。更改设置时递增版本，旧版本尚未发出的 NFT 批准失效，须重新审批；已发出的凭证继续核对。测试和生产值分开，测试用合成值，不进仓库。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/review`、`pnpm e2e e2e/features/memorial`、`pnpm verify`。覆盖双击、过时版本、接收地址变更使旧批准失效、逐项勾选、五类转人工、三开关独立与审计。真实登录到 E2 复验，功能 e2e 使用 Mock 样本会话。

### 2.2 · 公开投影、撤下和媒体

- [ ] 【AI 自动】公开页面和媒体路由沿用各环境现有的网站运行角色，统一从 `src/features/public/` 的公开投影查询读取。公开查询只返回共享授权策略允许的当前版本及公开字段。
- [ ] 【AI 自动】测试匿名首页、详情和媒体始终经公开投影，草稿、旧版、撤下、不上链的照片均不可公开读取，匿名写入被拒。测试和生产分别校验连接身份。
- [ ] 【AI 自动】`src/features/public/timeline.ts` 返回 `PublishedTimelineItem`，按北京时间日期、维护者指定顺序、收件时间及稳定 ID 排序。基于 `evaluateContentPolicy` 投影当前获准版本，并在首页、列表、照片与日记详情、`/api/media/[itemId]` 每个公开入口复核。站方媒体路由只持公开 ID，每次读取 Blob 展示副本前检查当前发布、版本和排除标记。返回 `Cache-Control: private, no-store`，阻止 Next 图片缓存旁路和失效后 304。展示图按 D1 性能结果压到合适尺寸并懒加载。地基为「打开公开样本」提供仅 Preview/本地 Mock 启用的短期签名票据，`public` 使用票据只读该 `runId` 已发布的投影。票据无维护权限，无票据的普通入口不显示任何合成样本。
- [ ] 【人工·D1/G2】在对应 Vercel 项目为公开 `/api/media` 配置基本限流，用低频突发确认限流、正常首图请求和撤下后的 404。D1 记录规则能力及读流量预算，G2 在正式项目复核。
- [ ] 【AI 自动】`src/features/review/withdraw.ts` 在数据库事务中切换可见性、暂停尚未发送的永久动作、立即标记受影响 ZIP 不可下载及使在途导出无效。删除旧对象由工作器处理并核对结果不丢；异常留待办。已广播或已永久确认的凭证继续保留并查证。旧日记回滚写成新修订，重新审核当前公开授权，重新永久归档需要独立批准。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/review src/features/public src/app/api/media`、`pnpm e2e e2e/features/memorial`。覆盖匿名当前版、明确排除、待批准、撤下后旧媒体、旧版本、撤下和导出竞态。

### 2.3 · 纪念日与首页验收

- [ ] 【AI 自动】`src/features/review/anniversary.ts` 写 `SitePresentation`，`src/features/public/presentation.ts` 读当前生效投影。用 `Asia/Shanghai`，纪念日从当天零点到次日零点，未设或不可用则显示平日版。2 月 29 日非闰年于 2 月 28 日展示，测试可注入固定时钟；预览按钮只影响维护者预览。保留首屏媒体、文案、焦点、分组、精选字段供 G1 使用。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/review src/features/public`、`pnpm e2e e2e/acceptance/memorial.spec.ts`、`pnpm verify`。覆盖跨日、闰年和失效回退。确认从审核到公开的锁定路径通过，只开启 `memorial.json`。首页及导航保留 `home.spec.ts` 锁定的「首页」「维护后台」可访问名称，G1 同样复验。

## 板块 3 · `permanent` 永久归档与 NFT

**范围与可写路径**　`src/features/permanent/**`、`src/app/api/permanent/**`、`src/app/maintain/permanent/**`、`contracts/src/**`、`contracts/test/permanent/**`、`contracts/script/**` 及本块额外路径。交付以工作器执行的自动合约部署、永久副本处理、Turbo、链上核对、版本和状态。开发用地基授权快照与合成样本，联调使用 `review` 的真实共享记录。

**禁碰**　共同禁区适用；禁止修改 `contracts/foundry.toml`、`contracts/remappings.txt`、`contracts/lib/**`、地基的 `contracts/test/Toolchain.t.sol`、全局闸、原稿/公开/导出逻辑。真实 Turbo 和正式链签名仅由 G2 授权后的正式工作器执行。合约源码和元数据不得写入真实猫名。

**预览验收**

1. 在预览用「样本登录」，打开「永久任务」，选择合成授权照片，点「运行样本」。查看「归档确认」后才出现「NFT 已到账」，详情显示永久图 ≤100,000 字节、数据项 ID、唯一 tokenId 和正确的测试接收方。点「重跑样本」，改日期或图注再跑，已有凭证不变，计数仍为一。查看不上链的合成照片，列表没有永久写入或铸造任务。
2. 选「部署广播后超时」，点「运行样本」看到「结果待核对」并记交易哈希及预测地址。点两次「重跑样本」，继续使用原哈希和地址。核对回执后显示「合约已部署」，样本报告只有一次签名和一个合约地址。分别选「余额不足」和「结果未知」，看到「需处理」，交易发送次数未增加。
3. 选获准归档的合成日记，详情展示「恢复校验通过」，回读与获批正文一致；后续编辑一版，默认没有新增归档。确认真实开关关着时，预览仍可验证 Mock 路径且没有主网交易。

### 3.1 · ERC-721 自动部署与重跑恢复

- [ ] 【AI 自动】`contracts/src/MemorialPhotos.sol` 与 `contracts/test/permanent/MemorialPhotos.t.sol` 交付 ERC-721。构造参数为 `name_`、`symbol_`；`msg.sender` 同时是 owner 和初始 minter。`setMinter(address next)` 只允许 owner；`mint(address to, uint256 tokenId, string tokenUri)` 只允许当前 minter，一个交易直接铸到审批所绑的接收地址。合约拒绝已有 `tokenId`，元数据仅通用名称和审核图引用。`contracts/script/` 提供可复现 ABI、creation/runtime bytecode 构建与哈希命令及产物描述，使用 0.1 锁定的工具链。工作器按同一构建规则验证产物；脚本仅构建和核对，广播由下述持久化签名流程统一执行。
- [ ] 【AI 自动】`src/features/permanent/deploy.ts` 消费 `DeployContractJob`。F2 对应的审核和同提交验收均通过后自动排一次 OP Sepolia 部署；G2 核准发布进入 `main` 且 `OP 主网交易`、`ALLOW_MAINNET` 同时放行后自动排一次 OP 主网部署。受信发布记录绑定审核 SHA、已发布工作器 SHA、链 ID、合约产物哈希和构造配置版本。工作器验证发布及门闸后自行入队并持锁执行，成功后核对地址、运行字节码、部署者、owner、minter，持久化凭证和源码验证结果。链 ID 分别为 `11155420`、`10`。
- [ ] 【AI 自动】工作器只读核对受保护分支已有证据，自行生成发布记录并入队。测试用 `integration` 上同 SHA 的合并评审、可信迁移与完整 e2e；生产用维护者合入 `main` 的发布提交，对照同一已审核 SHA 的迁移和平行测试证据、工作器已发布的版本及 G2 执行闸。证据缺失、错 SHA 或来源不符时停发并记录原因。
- [ ] 【AI 自动】按核准 SHA 与锁定工具链构建一次，签名前核对实际产物哈希、按网络检查钱包及费用预留、用 `estimateGas` 或 `eth_call` 预演，执行 `maxFeePerGas`、`gasLimit` 上限。支付能力不足转人工，估算超限留技术卡点，发布证据或链上结果无法证明时停发核对。G2 核对相同产物哈希已在 OP Sepolia 自动部署且成功铸造。
- [ ] 【AI 自动】部署键为 `(环境, chainId, 部署版本)`，首版为 `memorial-erc721-v1`，重跑沿用原键。测试网仅对受审的新产物或构造版本显式递增，不能用递增绕过结果未知的前次交易。首版主网只登记一个合约，确认部署后冻结其键与地址。同键产物、构造或签名身份冲突标为「结果待核对」。签名前检查已有结果；签名后、广播前持久化 `deployer`、`nonce`、链 ID、构造和产物摘要、预测合约地址、原始签名交易及哈希。超时或进程重启先查原哈希回执与链上交易、预测地址代码及发送者 nonce。成功必须回执、部署地址、代码和权限一致。确认未入池且 nonce 未被消耗时，只能重播同一原始签名交易；已挂起只轮询。nonce 被未知交易使用、回执失败或结果无法证明时停在原部署键并记录证据，自动流程不换 nonce、不签新部署、不覆盖已登记合约。测试网和主网分别保留同一规则。
- [ ] 【AI 自动】**自动检查**　`forge test --root contracts`、`pnpm exec vitest run src/features/permanent`、`pnpm e2e e2e/features/permanent`、`pnpm verify`。本地链测非 owner、非 minter、mint 重复 ID；Mock 测广播前后崩溃、已见回执、已挂起、RPC 超时、同哈希重播、nonce 被外部交易占用、错产物或 SHA、费用上限、双闸关闭时无广播。连续重建比较产物哈希。
- [ ] 【人工·F2/G2】在 F2 验收测试网自动部署和一枚验证铸造，在 G2 核对正式网自动部署凭证。现场观察既有流程的自动签名及结果，超时回到原操作键和凭证查验。

### 3.2 · 归档、核对与一次铸造

- [ ] 【AI 自动】`src/features/permanent/archive-photo.ts` 从 Contabo 原图生成独立无元数据永久副本，校正方向，逐步降低画质/分辨率，保证 ≤100,000 字节，无法达标则记技术失败。`src/features/permanent/execute.ts` 只处理共享策略允许的当前获批版本，发送前再次检查相应开关、环境、执行闸、余额、接收配置及撤下。待发的关停，已发的继续核对。照片的操作键为 `(环境, 照片身份, 动作, 网络)`；日记绑定获批修订 ID；手续费未结算的本项目在途操作仍占用预算。共用钱包可能出现外部花费或 nonce 变更，签名前按当前链状态重算；不明冲突保留凭证并停止新签名。
- [ ] 【AI 自动】`src/features/permanent/reconcile.ts` 先持久化已签名完整数据项或原始交易及其 ID/哈希，再发。Turbo 写入后由工作器主动轮询 GraphQL 和网关，数据项可查询、所在打包交易至少 3 个区块确认、网关回读字节 SHA-256 一致才写「归档确认」。从稳定照片 ID 的 UTF-8 SHA-256 派生 `tokenId`，铸造前查存在性；复跑、换日期或图注、重复压缩及同素材裁剪复用已确认凭证。裁剪版本另需审核。根据交易回执与 `ownerOf(tokenId)` 核对到账后才记「NFT 已到账」。RPC 和 Turbo 结果未知先查原凭证，只有确认允许重播才发同一签名产物。合约及资产签发路径不接收外部支付 webhook，Turbo/Base ETH 充值由使用者完成、工作器主动查余额；OP 与 Turbo 的结果均通过出站轮询验证，链 ID/内容哈希/回执与唯一操作键承担关联和去重。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/permanent`、`pnpm e2e e2e/features/permanent`。用 Mock 测未确认阻断、错误哈希、乱序回报、已铸、同图重复、重复消费、接收配置变化、余额不足和撤下后拦截。【人工·F2/G2】F2 用 ArLocal 走归档逻辑，G2 才连真实 Turbo。

### 3.3 · 日记加密、恢复和后台凭证

- [ ] 【AI 自动】`src/features/permanent/diary-envelope.ts` 提供 `sealDiary(revision, passphrase): Promise<DiaryEnvelopeV1>` 和 `openDiary(envelope, passphrase): Promise<DiaryRevision>`。口令先 NFC；Node 24 Argon2id 用 64 MiB、3 轮、并行度 1、随机 16 字节盐派生 32 字节密钥；AES-256-GCM 每次用独立 12 字节 nonce，16 字节认证标签。版本化 JSON 信封含修订 ID、算法、KDF 参数、盐、nonce、认证标签、密文；修订 ID 和格式/算法参数以定序 JSON 编为 AAD。只封存获批修订的正文及获批标题、日期；落库前读取生成的信封，解密核对原内容后才广播，确认时再核对网关字节哈希。保留数据库明文和私有历史；默认为首个获批版本归档，后续仅数据库更新，单独批准才归档。口令疑似泄露时暂停新归档，旧密文须按已暴露可能处理。
- [ ] 【AI 自动】`src/features/permanent/` 内交付复用 `openDiary` 的离线解档脚本和简短格式说明。输入为版本化信封、交互式隐藏口令，说明 3.3 的 KDF/加密格式及 D1 确认的口令规范。用合成信封验解码与认证失败，口令不经参数、配置文件或日志。
- [ ] 【AI 自动】`src/app/maintain/permanent/**`、`src/app/api/permanent/**` 只返回当前维护者可用的 `JobSummary` 和受限 `OperationReceipt` 公开字段，内部签名交易、原始输入及口令永不返回。测试样本的运行和重跑只使用 Mock。日常状态包括「排队」「执行中」「归档确认」「NFT 已到账」「合约已部署」「结果待核对」「恢复校验通过」「需处理」。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/permanent`、`pnpm e2e e2e/acceptance/permanent.spec.ts`、`pnpm verify`。测试错误口令或修改 AAD/密文失败、不同加密 nonce、旧版默认不产生任务、重读和验收通过，只开启 `permanent.json`。 [Node.js Argon2 API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback)

## 板块 4 · `exports` 私有离线快照

**范围与可写路径**　`src/features/exports/**`、`src/app/api/exports/**`、`src/app/maintain/exports/**` 及本块额外路径。交付维护者按需生成和下载的一份私有 ZIP，包含可离线阅读的 HTML、当前图文和清单。

**禁碰**　共同禁区适用；禁止修改进稿、版本、授权政策、公开媒体、归档与钱包任务，禁止新增公开 ZIP 路由或分享版。消费地基的授权、当前快照和撤回契约。

**预览验收**

1. 在预览用「样本登录」，在「离线快照」点「生成离线快照」，看到「正在生成」，完成后点「下载离线快照」。断网解压并打开 `index.html`，相对路径的图片、图注和最新版日记可读。授权可私下导出的不上链照片在包内，草稿、旧日记、明确禁止导出的素材及个人信息均省略。打开 `manifest.json` 核对版本、路径和哈希。
2. 隐身窗口打开站内下载地址，被拒绝。再回后台点「生成离线快照」，只保留一份当前结果。记录本轮测试直下链接，在审核页「撤下」一件已含素材，再刷新：离线快照页显示「需重新生成」，站内入口不能下载，旧 Blob 删除完成后原未过期直下链接也失败。重新生成后才能下载新的 ZIP，包内无已撤下项。
3. 在样本生成过程中变更导出许可，原任务结束后下载入口仍关闭。故意使 ZIP 上传失败，看到「生成失败」，当前下载关闭，重新点「生成离线快照」可成功。

### 4.1 · 本机生成、覆盖与撤回

- [ ] 【AI 自动】`src/features/exports/generate.ts` 对维护者请求执行 `createPrivateExport(input: ExportRequest): Promise<JobSummary>`。复用现有任务表，每个环境只允许一个活跃生成任务；并发请求返回该任务。开启新一轮即置当前包不可下载并清旧对象，Contabo 从共享策略取当前获准的内容，流式写临时 ZIP，生成相对路径 `index.html`、`media/`、`manifest.json`。每条包含修订 ID、相对路径与 SHA-256，HTML 转义文字，去掉内部身份、源邮箱、原文件名和图片元数据。完成后从 Contabo 直接上传私有 Blob，用每次不可复用的对象键保证已签发的旧链接永远不会读到新包。数据库只保留一份当前指针，无用户可见历史版本。
- [ ] 【AI 自动】确认 Blob 完整并再次核对授权与生成版本，原子开放「下载离线快照」。撤下、排除或导出授权变化时在 2.2 同一事务禁用当前指针及作废受影响生成，工作器重试删除旧对象并确认删除；上传失败清理半成品。`src/app/api/exports/download/route.ts` 每次验证维护者及当前可下载指针后才签发该对象 ≤60 秒、绕过 Blob 缓存的只读直下链接；函数不传输 ZIP 字节。已下载的离线副本仍由持有人控制。
- [ ] 【AI 自动】**自动检查**　`pnpm exec vitest run src/features/exports src/app/api/exports`、`pnpm e2e e2e/features/exports`、`pnpm e2e e2e/acceptance/exports.spec.ts`、`pnpm verify`。Mock 覆盖并发、离线解压、清单校验、权限变化、旧链接、上传失败及带有大尺寸原图的 ZIP。交付时只开启 `exports.json`。【人工·D1/F2】D1 实测旧链接失效和大 ZIP；F2 复核最终实现。

## 共享契约与所有权

所有 HTTP 业务 JSON 带 `schemaVersion: 1`，ID 为字符串，时间为 UTC ISO 8601，站点日期为北京时间 `YYYY-MM-DD`，金额用最小计费单位的非负整数字符串。公开投影不带私有文件引用、历史版本、邮箱或原稿证据。以下契约由 0.2 固定为 TS + Zod，跨板块只读取或提交这套结构。

| 契约 | 字段和职责 |
| --- | --- |
| `PrepareUploadV1`、`UploadGrantV1`、`FileRef` | 入参 `eventId, sender, position, mediaType, sizeBytes, sha256`，输出 `objectKey, uploadUrl, expiresAt`，文件引用 `objectKey, mediaType, sizeBytes, sha256`。文件路径采用服务端生成的对象键，属于当前环境、Bot 与事件。 |
| `IntakeEventV1`、`SubmissionDraft` | 事件 `eventId, sender, receivedAt, sourceMessageId?, sourceProof?, inReplyToId?, commonDateHint?, items[]`。各项有 `kind, position, dateHint?, exclusionQuote?, attachmentRef?, diaryText?`。私有草稿带 `submissionId, receivedAt, source, items[], pendingReasons[]`；条目含 `itemId, versionId, kind, localDate?, dateSource?, disposition, candidates[]` 与私有文件/日记引用。保存可核对的发件标识和授权/拒绝原句，Grok 自报来源保留来源标记。私有证据导出不得写入真实白名单邮箱。 |
| `ReviewDecision`、`ApprovalSnapshot` | 审核输入含 `submissionId, requestId, decisions[]`。每个批准快照含 `itemId, versionId, publicView, arweave, nft, approvedAt, source, recipientConfigVersion?`，来源 `manual` 或 `automatic`。数据库事务写快照与待执行任务，NFT 复核接收配置版本。默认授权以投稿人可授权范围为限。 |
| `ContentPolicyInput`、`ContentPermissions` | 输入含 `itemId, currentVersionId, approvedVersionId?, published, withdrawn, exclusion, usageRights`。返回 `publicView, privateExport, arweave, nft`。未匹配当前版本、撤下、用途未许一律不放行对应能力，明确排除只保留有效的私有导出能力。 |
| `JobSummary`、`OperationReceipt`、`DeployContractJob` | `JobSummary { jobId, createdAt, updatedAt, status, reason? }`，`status` 为 `queued`、`running`、`done`、`needs_attention`。凭证内部字段包括 `operationKey, network, payloadHash, signedPayloadRef?, dataItemId?, txHash?, tokenId?, nonce?, predictedAddress?, confirmedAt?`。部署请求含 `reviewedSha, releaseSha, chainId, artifactHash, constructorConfigVersion`，只由受信发布记录生成。内部签名数据保留在受限记录或文件中，摘要仅展示白名单字段。 |
| `PublishedTimelineItem`、`SitePresentation` | `PublishedTimelineItem { itemId, currentVersionId, localDate, sortOrder, kind, title?, caption?, publicMediaRef?, diaryText?, focalPoint?, layoutRole? }`，照片可附版面尺寸、分组、精选标记。`SitePresentation { heroMediaRef?, heroCopy?, anniversary: { monthDay?, headline?, copy?, heroMediaRef? } }`。`review` 写授权和设置，`public` 派生公开数据。 |
| `ExportRequest`、`ExportManifest` | `ExportRequest` 由已验证会话的服务器处理；工作器认服务器写入的请求发起身份及当前授权。`ExportManifest { generatedAt, items: [{ itemId, versionId, path, sha256 }] }`。ZIP 维护唯一当前状态，授权变化同事务作废；旧文件的对象键永不复用。 |

地基提供受保护的服务器工作器入口，固定导入四个最小模块插座 `src/features/{intake,review,permanent,exports}/jobs.ts`。地基先交付空插座，E3 后各自所有者实现 `handleJob(job: JobInput, context: WorkerContext): Promise<void>`，`JobInput` 和 `WorkerContext` 在 `src/lib/contracts/jobs.ts`，仅暴露该环境的文件适配器、数据库任务操作及 clock。归档、展示图和导出由相应板块负责。所有者不交叉改插座和路由，后加的 job 类型放在现有共享类型提供的 `kind + schemaVersion` 边界内。各板块私有 URL 在 PR 预览可按本计划直接打开，F2 核对地基静态导航注册项和实际页面一一对应，路径和锁定名称均可达。

## 凭据配置清单（B.7）

`.env.example` 列变量名、用途、环境及允许的落点，所有值留空。应用 `NEXT_PUBLIC_` 只用于 Supabase 公共 URL/匿名公开 key 等公共值。`.env.local`、Contabo 测试环境文件、Vercel Preview、GitHub Secrets / Environment 分放。首版没有发信服务 key。

| 凭据或配置 | 本机 `.env.local` | Contabo / Bot 安全配置 | Vercel Preview | GitHub / 正式落点 |
| --- | --- | --- | --- | --- |
| Supabase Auth 项目 URL、匿名公开 key、环境维护者 UID | 共用项目公开值、测试 UID 按需 | 开发按需仅测试 UID | 同一项目公开值、仅绑定测试 UID | 正式 Vercel 绑定生产 UID，两个账号的密码由维护者私下持有 |
| Postgres `DATABASE_URL`、`WORKER_DATABASE_URL` | 受限测试连接按需 | 受限工作器连接只领任务和回写，开发连接只访问测试 schema | 测试网站角色，仅服务端 | 正式网站和工作器分别持生产运行角色。CI 常规验证无云端运行凭据 |
| `GROK_INTAKE_TOKEN`、样板令牌、固定 origin | 本地测试按需，只用合成发件配置 | Grok 安全配置持对应令牌和回调；板块 1 切换后撤样板令牌 | 测试 Bot 令牌及测试 origin | 正式令牌仅 Grok 与 Vercel Production；非机密的测试/正式 origin、测试项目标识和实测部署事件环境名用 Actions Variables，工作流不写实际值 |
| 白名单 SHA-256 摘要 | 只用合成输入 | — | D1 私下录入摘要 | 正式录入对应摘要；真实邮箱仅参与内存比对，不写文件、样本、日志或导出 |
| Blob 项目身份和访问凭据 | 测试按需 | 工作器仅取对应环境的存储凭据 | 测试专用 store，服务器处理 | 正式 store 仅 Vercel Production 和正式 Contabo 工作器访问 |
| Supabase 项目级管理和 Auth 管理凭据 | — | — | — | 维护者保管项目所有者凭据和 `service_role`，可信体检作业仅在 GitHub `db-admin`（限 `main`）取项目标识及所需管理令牌。D1 核对管理令牌是否还可访问其他项目并记录范围；项目级凭据可能触达生产，禁止用于板块 SQL |
| Postgres 迁移角色凭据 | — | — | — | `db-admin` 用测试角色，`prod-db-admin` 用生产角色。两者都限 `main`、仅可信迁移作业；生产仅人工触发，按 0.7 核验环境审批、固定 schema 和触发方式 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | — | 测试 Grok 仅在需通过平台保护时用测试值 | 由测试项目签发 | 仓库级唯一敏感例外，仅用于测试 Preview；按 B.7 接受运行测试代码可读测试放行值的风险 |
| 链 RPC、区块浏览器源码验证、Turbo | 本地链、ArLocal、Mock 按需 | 测试使用 `OP_SEPOLIA_RPC_URL`、`ALCHEMY_OP_SEPOLIA_RPC_URL`（备用 key）及 `OP_SEPOLIA_EXPLORER_API_KEY`；测试签名私钥与正式钱包各放 `agent` 的 `~/secrets/`（`0600`）。`OP_MAINNET_RPC_URL`、`OP_MAINNET_EXPLORER_API_KEY` 与 Turbo 正式运行配置仅正式工作器使用 | Mock | GitHub 单测 Mock/本地链；正式钱包私钥可读的例外见全局约束 |
| EVM 私钥、`DIARY_ARCHIVE_PASSPHRASE`、`ALLOW_MAINNET` | — | 生产钱包按 B.7 例外放 `agent` 的 `~/secrets/`，口令和闸限正式签名服务的受限配置 | — | 维护者部署并保护正式程序和 systemd 配置。CI、预览和开发环境文件均无闸与生产凭据。共用 `agent` 的私钥可读性见全局约束 |
| `TEST_DIARY_ARCHIVE_PASSPHRASE` | 合成值 | 测试工作器可用合成值 | 合成值 | CI 用合成值，真实口令仅正式执行配置 |
| 接收配置 | 合成地址 | 工作器读当前版本，不配置额外明文文件 | 测试数据库私有站点设置 | 生产数据库私有站点设置，维护者录入并按 2.1 版本化 |
| 保留与额度 | 合成测试阈值 | `DISK_WARN_PERCENT`、`TURBO_WARN_CREDITS`、`MAX_FEE_PER_GAS_WEI`、`MAX_GAS_LIMIT`、`MAX_OPERATION_COST_WEI` | `MAIL_RETENTION_DAYS`、`INTAKE_REQUESTS_PER_MINUTE`、`INTAKE_MAX_ITEMS`、`INTAKE_MAX_EVENT_BYTES`、`INTAKE_MAX_STAGED_BYTES`、`UPLOAD_GRANT_TTL_SECONDS`、`PRIVATE_READ_TTL_SECONDS`，按 D1 实测填写 | 正式网站和工作器各取本进程适用值，平台限制和告警见 D1.2/2.2 |
| `WORKER_NOTIFY_ENDPOINT`、`WORKER_NOTIFY_TOKEN` | Mock | 按环境指定现有通道；生产端点与凭据仅正式配置 | — | G2 维护者验证按环境送达 |
| GitHub 机器账号、AI CLI、Cezar 和通知 | — | GitHub 机器账号经典令牌权限 `repo`、无 `workflow`，仅获邀仓库。以 `agent` 完成 AI CLI 登录。Cezar 口令、通知令牌和 `chat_id` 在各自服务配置 | — | 维护者掌握平台管理权限，仓库级无其他敏感值 |

生产工作器和开发进程共用 `agent`。生产用系统级 `memorial-worker@prod.service`，管理员将运行凭据、口令及执行闸存于 `/etc/` 下 root 属主 `0600` 的 `EnvironmentFile`，由 systemd 装载；执行程序仍以 `agent` 运行。文件权限只保护直接读取，不能证明同 UID 的进程环境、日志或系统控制面隔离。

【人工·D3/E3/G2】D3 用合成凭据评估并冒烟验证夜间沙箱的挂载、进程可见性与禁提权；只放行所需工作目录、测试配置和明确例外的钱包，生产程序和数据目录不纳入开发工作区。E3 从真实夜间 runner 上下文测试直接读文件、读其他进程 `/proc/<pid>/environ`、查 `journalctl`/systemd 环境和访问生产目录；同时验证样例工作器正常和钱包例外可读。G2 复验正式服务，日志只记通过或失败。访问非例外凭据的路径未验证或失败时保持正式闸关闭，修正配置后重验。

## F2、G1、G2 · 集成、呈现与上线

### F2 · 整体验收与类型入库

- [ ] 【人工·F2】打开最新全绿 `integration` 预览链接，用合成样本从「投递样本」→「审核投稿」→「时间线」→「永久任务」→「生成离线快照」完整走一轮。核对排除贯穿各入口，重投和撤下按共享策略生效，失败记录可查。按 0.1 注册表核对维护导航和实际页面；按 0.7 将生成类型同步到受保护文件并重跑同提交流程。演练真实 OP Sepolia 自动部署和单次铸造、ArLocal 回读；失败按原凭证核对，正式服务保留关停。
- [ ] 【人工·F2】**自动检查**　`pnpm verify`、`pnpm e2e`、`pnpm exec tsx e2e/support/check-delivered.ts`、`forge test --root contracts`，验最新 `integration` 提交的报告、数据库类型和权限证据；部署核对命令由板块 3 交付 `pnpm exec tsx src/features/permanent/verify-deployment.ts --network op-sepolia`，只查已知凭证。

### G1 · 公共页试装

- [ ] 【人工·G1】单线试装，只修改 `public` 所属页面、组件和局部样式，复用地基语义变量与 `--font-heading`，调整版式和动效。打开试装预览，在手机与桌面走首页、时间线、照片与日记；纪念日样本可切换、键盘可操作、页面无横向溢出。试装是 F2 之后的独立阶段，夜间交付使用保底主题。
- [ ] 【人工·G1】**自动检查**　`pnpm verify`、`pnpm e2e e2e/acceptance/home.spec.ts e2e/acceptance/memorial.spec.ts`。对比度、基础可用性、手机防溢出和截图目检证据按 0.6。

### G2 · 生产迁移、自动部署与一次合成图演练

- [ ] 【人工·G2】维护者确认最后的测试 SHA、规则集、类型和权限，按 0.7 从 `main` 手动触发 `migrate.yml` 的生产模式，填已经核准的完整待发布 SHA；仅迁移生产 schema，不执行测试 seed。维护者以 merge commit 将 `integration` 发布到 `main` 并把 Vercel 生产分支设为 `main`。核对正式部署 SHA，按 0.5 用已核准 SHA 发布生产工作器，确认迁移成功在先，录入并核对生产接收配置；按凭据清单完成运行隔离复验。打开正式 `*.vercel.app` 确认匿名首页、`/debug` 和样本入口的 404、正式维护者登录与登出、测试维护者身份拒绝及跨 schema 拒绝。启用只读监控并确认磁盘 80% 与付费服务告警送达。
- [ ] 【人工·G2】使用者按已计划流程在正式签名服务启用 `ALLOW_MAINNET=true`，打开「OP 主网交易」。流程按 3.1 自动部署已审核 ERC-721，核对链 ID、合约地址、部署者、owner、minter、接收配置与源码验证。自动审批保持关闭，使用者只批准一张合成图并开「真实 Arweave 写入」。用真实 Turbo 归档，满足 3.2 确认条件后由上一步合约铸一枚到固定接收地址，在 SEMI App 确认显示；合成图从正式时间线排除。记录数据项 ID、交易哈希、tokenId、费用、App 结果。失败或结果未知立即停发、只核对该操作，撤除执行闸；通过后也撤除。站内自动审批由自己的开关控制。持续执行真实动作须获使用者明确授权保留执行闸，并分别开启对应的真实写入或主网交易开关。撤下仅控制站方入口，已确认的永久写入和转账不能回滚。
- [ ] 【人工·G2】首版按已定范围豁免异地备份恢复门禁，覆盖文件及数据库。仅用合成数据核对现有恢复线索：已知 Arweave 数据项可回读其永久副本，加密日记还需口令；链上交易可重查已知合约、铸造及持有人；已下载的私有 ZIP 只恢复包内获准内容。它们均无法完整恢复数据库审批和历史、操作键、未确认交易对账或私有原稿。未下载 ZIP、未归档原图及仅存数据库的记录在对应唯一副本遗失时无法从上述来源恢复。遇数据库状态丢失先关闭三个开关和执行闸，核对可用证据再考虑恢复处理。记录实际可回读范围，不假定托管方有可用备份或发生了数据丢失。
- [ ] 【人工·G2】**自动检查**　`node scripts/prod-readonly.mjs`、本次 `migrate.yml` 类型比对及体检；受控发布任务运行 `pnpm exec tsx src/features/permanent/verify-deployment.ts --network op-mainnet` 核对同一交易和合约，不签名、不扣费。真实合成图演练仅在此阶段执行一次，常规 CI 继续使用 Mock。
