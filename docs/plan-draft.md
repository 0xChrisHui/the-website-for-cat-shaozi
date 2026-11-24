# 猫咪纪念网站 · 第一轮计划草案

**目标**　首版交付邮件投稿、维护与审核、公开时间线和最新版日记、永久归档及 NFT 路径、离线导出与纪念日切换。功能验收先用朴素页面，首页第一屏和时间线为 G1 的视觉打磨保留数据位置。

**依据**　[需求原话](requirements.md)、[产品问卷](questionnaire.md)（含第九节全部澄清）、[工作流手册](workflow-manual.md)及本轮技术答复。涉及收件证据、导出和部署范围的决定以本轮答复为准。工程护栏按手册附录 B.1–B.7，板块 0 依 E1–E3 执行。本文件是 C2 第一轮草案，路径和接口供 C3 定稿。示例使用合成数据与代称。真实猫名、邮箱、钱包地址、白名单和凭据均在仓库外私下处理。

## 1. 技术方案

| 用途 | 首版方案 |
| --- | --- |
| 网站和 API | **Vercel + Next.js App Router、TypeScript、Tailwind CSS、shadcn/ui**。一个应用承接公开页面、维护界面、Bot 接入、任务登记和结果查询。测试项目负责 PR 与 `integration` 预览，生产项目仅接收 G2 放行的 `main`。 |
| 数据和登录 | **Supabase Postgres + Supabase Auth**。测试与生产共用一个免费项目，按 PostgreSQL schema 和独立运行角色隔离业务表、文件引用、授权和任务。项目统一关闭开放注册，Auth 用户目录共用，测试和生产各预建一个维护者账户，应用按环境校验各自的维护者身份。详见 B.7 的共用项目例外。登录、密码校验、失败限流与会话由 Supabase Auth 负责。数据库权限、RLS 和服务端维护者鉴权共同限制访问。 |
| 邮件与识别 | **使用者现有的 Grok Bot 和邮箱**。Grok 单独收件，首版不接 Cloudflare 入站邮件。测试与生产各有静态长期令牌，权限限于交稿接口（含 `prepare` 和提交），仅由 Bot 从安全配置经 HTTPS 请求头出示。已在真实 Grok 验证该方式，令牌不进提示词或日志。网站以 Grok 自报的原始发件人做最终白名单判断。Grok 无法提供可核验的发件人证据（原始 `.eml`、Message-ID 或 SPF/DKIM/DMARC 结果），发件人可被冒充。前期 Grok 来信一律人工确认，使用者开启自动审批即视为接受这一风险。 |
| 文件与磁盘 | **Vercel Blob + Contabo 100 GB 磁盘**。Grok 将原图直传私有 Blob，Contabo 工作器主动拉取并保留原图。去元数据的高画质展示副本发布到 Vercel Blob，独立的 Arweave 永久副本（≤100 KB，即 100,000 字节）和私有 ZIP 在 Contabo 生成。磁盘到 80% 告警，Blob 免费额度在 D1 核算。 |
| 永久保存 | **Arweave + Turbo**。使用者用 Base ETH 手动充值 Turbo 额度。同一把 EVM 私钥签 Arweave 数据项并支付 OP Gas，同一地址在 Base 和 OP 上分别准备 ETH。单个数据项 ≤105 KiB 且钱包和网络段均有剩余额度时可免费上传，10 MiB 终身额度不会刷新。常规计划计入充值费用。CI 用 Mock，人工归档预演用 ArLocal 验证归档逻辑，真实 Turbo 通路按 G2 放行。`arweave-js` 加独立 AR 钱包仅作备选。 [Turbo 计费与免费额度](https://docs.ar.io/build/upload/turbo-credits) |
| NFT | **`viem` + 自有 ERC-721**。基于 OpenZeppelin `Ownable`，owner 可通过 `setMinter` 更换铸造者。名称由构造参数提供，部署时由使用者决定取名，合约代码和 NFT 元数据禁止写死真实猫名。OP 主网直接铸给使用者事先确认的 OP 接收公钥所对应的地址，一笔交易完成铸造与空投。CI 用 Mock。测试和评审通过后，流程自动部署 OP Sepolia 和 OP 主网合约。每个环境用本环境的一把 EVM 私钥同时担任部署者、owner 和 minter。测试网先用公共 RPC 和测试币铸一枚核对。有需要时切换到单独的 Alchemy OP Sepolia 测试项目。G2 的主网部署受默认关闭的“OP 主网交易”开关和生产执行闸控制，两项均由使用者启用。主网显示用第 3 节的合成图验证。生产用 Alchemy OP Mainnet RPC，核对额度与告警。 |
| 长任务 | **已有的 Contabo 服务器**，与开发用 Cezar 同机。签名与上传服务由 systemd 管理，与 Cezar、Codex 共用 `agent` 用户，主动轮询 Supabase 任务表，领取、执行和回写，恢复中断任务，也可用受限身份生成大 ZIP。永久工作器每个环境只运行一个进程，以 PostgreSQL 会话级 advisory lock 保证单实例。站点相关的 Contabo 工作器仅发起出站连接，Contabo 不开放任何公网入口。钱包私钥的存放与读取范围见 B.7 的本项目例外。 |
| 域名 | 开发期使用 Vercel 默认预览域名。自定义域名延后，最终与客户确认后再购买，不列入当前等待项。 |
| 交付与通知 | **GitHub Rulesets / Actions + Vercel Preview**，开发编排按手册使用 Cezar。任务失败留站内，交付和生产故障优先走现有通知通道，尚未配置时用 Telegram Bot。 |

**文件入口**　Grok 调用网站的 `prepare`，取得 Vercel Blob 提供的短期单对象上传凭证，按大小限制将原图直传到私有 Blob。Contabo 工作器主动拉取并流式核对实际大小和 SHA-256，原图落盘并持久化文件引用后可删除 Blob 暂存件。超期未提交的暂存件按有效期清理。需取回已清理暂存件的私有原图时，由工作器按需重新暂存，读取前由网站核对维护者权限。工作器将展示副本发到私有 Blob，由 `public` 的媒体路由按当前发布状态和排除标记提供读图，撤下即封住站方入口，媒体禁止共享缓存。工作器将当前 ZIP 上传到私有 Blob，维护者经网站校验权限和当前状态后取得短期直下链接，避免大 ZIP 经网站函数传输。D1 用真实 Grok、Vercel、Contabo 和使用者浏览器实测原图直传与拉取、展示图在中国大陆的加载速度、大 ZIP 下载和旧包撤回，并按预估用量和实测数据核对 Blob 免费额度的存储、传输和操作量是否够用。 [Vercel Blob 签名链接](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob) · [私有 Blob](https://vercel.com/docs/vercel-blob/private-storage) · [Vercel Blob 用量与定价](https://vercel.com/docs/vercel-blob/usage-and-pricing)

**三项独立开关**　真实 Arweave 写入、OP 主网交易和自动审批默认关闭，可分别启停。前期每封投稿只需在同一页确认一次，可按素材独立勾选站内发布与永久操作。使用者主动启用自动审批即视为接受 Grok 自报发件人可被冒充的风险，系统记录接受时间，开关无自动过期。自动路径仍检查白名单、素材授权和版本。符合条件的 Grok 投稿自动审批，按相应开关和生产执行闸自动执行 Arweave 永久写入及 OP 铸造与空投。遇到拒绝、授权不明、要求更改接收钱包地址、钱包余额不足或操作结果未知时，将相应动作转人工，关停拦截尚未发出的动作，已发出的继续核对。“异常自动刹车”留到人工运行有数据后再决定。

**生产执行闸**　`ALLOW_MAINNET=true` 是 B.2 的运行前置条件，和三个产品开关分别检查，仅由使用者在 Contabo 上签名与上传服务的受限配置中设置。G2 首次按手册人工启用、验证、撤除。持续自动期须由使用者明确授权保留执行闸，停用时撤除。程序执行前核对环境、网络、批准的版本和动作、余额及任务状态。开发只能用 Mock、测试沙箱或 OP Sepolia，CI 默认 Mock。

**资金与不可逆结果**　使用者私下提供固定 OP 接收公钥，接收方与付款钱包分开，邮件提出的新接收信息一律转人工。费用以 Turbo 额度与 OP Gas 余额为上限，无本站独立额度或自动充值。尚未反映在余额中的在途费用继续占用，结果未知先用原凭证查证。发生错误时停发、核对并撤下站方可控入口。已确认的永久写入与交易无法撤回，补发、补铸和补救转账留到以后。如未来复用付款钱包，再设计跨项目的交易串行与余额协调。

## 2. 板块划分与验收

板块 0（草案 ID `foundation`）先单独交付。E3 门二后，`intake`、`memorial` 和 `permanent` 可基于地基契约并行，最多三条线。`exports` 在 `memorial` 交付后开始。联调按入库 → 审核发布 → 永久操作与导出验完整流程。并行板块只通过共享契约、持久数据和测试样本交接，互相禁引 `src/features/` 私有实现。`memorial` 内分 `review` 与 `public`，继续作为一个板块交付。可由板块自行完成的数据库变更按下文追加迁移。其他公共依赖或契约变更仍按手册 3.1 搁置并列入 PR 的“需要地基变更”。

| 板块 | 范围与可写路径 | 可照做的验收 | 禁碰范围 |
| --- | --- | --- | --- |
| 0 · `foundation` 地基 | 预装依赖、公共类型、数据库、权限、适配器骨架、外壳、`/debug`、锁定验收、CI 和小型测试样板，见第 3 节。 | 打开预览的“首页”，核验 `verify` 与预览提交号，用有权限测试账号查 `/debug`；按 E3 真实投递后能刷新重读，重投仍只有一份。 | 生产项目、生产数据和真实钱包；其他板块业务实现及正式路由由各板块交付。GitHub 规则集和受控工作流的首次推送由使用者执行。 |
| 1 · `intake` 投稿整理 | `src/features/intake/**`、`src/app/api/intake/**`、`src/app/maintain/intake/**`。Bot 令牌校验、白名单、上传、去重、补件、逐项日期和排除指示，提供“投稿待办”。原邮件依保留规则，在证据和附件核验后才可清理。 | 投递并重投含三张图的信，其中一张为 HEIC。只留一条投稿，逐图日期及冲突按规则处理。坏件不影响其余私有草稿。“红色背景的那张”有多个候选时均挂起。错误令牌或不在白名单的自报发件人被拒。自动审批关闭时，白名单匹配的来信仍须人工确认。访客读不到原稿。移除白名单成员后，暂停其尚未处理或授权的稿件。 | 共同禁区及公开首页、时间线、发布审批、永久执行、导出路由。 |
| 2 · `memorial` 维护、发布与公开站 | `review` 负责维护、审核和撤下，含待办、历史和纪念日设置，可写 `src/features/review/**`、`src/app/maintain/page.tsx`、`src/app/maintain/review/**`、`src/app/maintain/settings/**`。永久动作交给板块 3。`public` 负责公开页面和媒体，可写 `src/features/public/**`、`src/app/page.tsx`、`src/app/timeline/**`、`src/app/photos/**`、`src/app/diaries/**`、`src/app/api/media/**`。两部分一起交付。 | 从审核到公开保留一条端到端验收。点“审核投稿”，按素材勾选站内与永久动作并一次提交。Arweave 尚未确认时，匿名访客已能在“时间线”查看获准发布的照片和最新版日记。不上链的图在页面、公开 API 及媒体直链均不可见，三处均使用地基提供的公开策略。撤下时站方入口失效，未发动作暂停。“纪念日预览”显示配置文案，未设日期使用平日版。 | 共同禁区及 `maintain/intake`、`maintain/permanent`、`maintain/exports` 和对应 API。 |
| 3 · `permanent` 永久归档与 NFT | `src/features/permanent/**`（含服务器执行入口）、`src/app/api/permanent/**`、`src/app/maintain/permanent/**`、`contracts/{src,test,script}/**`。交付 ERC-721 合约、测试与自动部署脚本，处理永久副本、日记加密、Turbo 写入、铸造、到账核对与“永久任务”。 | 用 Foundry 本地测试、Mock、人工 ArLocal 和 OP Sepolia 演练。验证只有 owner 可更新 minter，且非 minter 不能铸造。永久照片 ≤100 KB，达到第 4 节的 Arweave 确认条件后，同一照片最多铸一枚并核验接收方。重复触发、重启、改日期或图注均复用凭证，余额不足暂停。广播后超时只核对原操作。日记首次获批归档的版本做回读解密校验，后续默认仅存数据库。 | 共同禁区及 Bot 路由、公开页面、导出规则。G2 由使用者通过执行闸与相应开关控制主网自动部署、真实资金和永久写入。 |
| 4 · `exports` 私有离线快照 | `src/features/exports/**`、`src/app/api/exports/**`、`src/app/maintain/exports/**`。维护者按需生成和下载唯一一份私有 ZIP，再次生成覆盖这一份。包内 HTML 以相对路径引用图片，并附清单。对外分享版留待以后。 | 点“生成离线快照”，断网解压能读图文。允许私下留存的不上链照片可包含在内，私有草稿、旧日记、禁止导出的素材和个人信息应省略。验证匿名无法下载。撤下、排除或导出授权变化时立即关闭下载入口并删除旧包，重新生成后才可下载。 | 共同禁区及原稿、授权、公开路由、归档或钱包任务。 |

**共同禁区**　板块 1–4 的可写范围另含各自 `e2e/features/<ID>/**`、`docs/decisions/<ID>.md` 与交付时的 `e2e/acceptance/delivered/<ID>.json`。其余板块路径及地基共享项一律只读，包括 `src/lib/**`、`src/components/ui/**`、根布局、主题和 `DESIGN.md`、包配置和锁文件、`contracts/foundry.toml`、`supabase/**`（下文允许追加的迁移文件除外）、`.env.example`、`.github/**`、`.ai/**`、锁定验收和 fixtures。`.github/protected-paths.txt` 是 CI 守卫的受保护路径唯一来源，板块归属按计划与审查执行。

**板块追加迁移**　首次地基迁移仍由使用者按第 3 节手动执行。此后板块在 `supabase/migrations/` 仅可追加带自身 ID 前缀的迁移文件（在时间戳后的迁移名称上用板块 ID 作前缀），现有迁移和其他受保护路径仍只读。审查通过且合入 `integration` 后，由可信工作流按合并顺序自动串行应用到测试库，核对对应提交的数据库类型、RLS 与角色权限后，再跑该提交的整体验收。此处偏离附录 B.5 的“迁移由使用者手动触发”做法，需要同步修订工作流手册。放宽仅限测试库的后续板块迁移，生产迁移仍由使用者手动执行。

**站内规则**　白名单投稿的默认授权仅覆盖投稿人有权授权的站内公开、Arweave 和 NFT。画面中有他人、敏感资料或另行分发时先确认。不上链指示按照片编号或背景颜色等画面描述匹配，候选不唯一就挂起涉及的照片，无法确定范围则挂起整封相应动作。明确排除后只能私下保留，同一素材重投或更新仍继承排除，提交排除决定后禁止从“保留”改回“允许”。公开页面、API、媒体读取、离线导出及永久执行均调用第 3 节的共享授权策略。逐图、逐篇先用明确的本项日期，再取明确适用于整封的共同日期，完全没写适用日期才用北京时间收件日。保留原句，由 Grok 提取建议，网站用日期标签和日历校验确定性复核，格式无效、指代不明或冲突的条目进入待办。同日按维护者指定顺序，缺省按收件时间与稳定 ID。站外识别仍需素材授权，失败进待办，人工结论优先。公开站只读当前获准内容，旧日记留数据库。纪念日期和文案可配置，仅当日切换首页。G1 单线程先换主题值，再调布局与动效。G1 涉及的业务代码改动仅限 `public`。

## 3. 板块 0 · 地基交付

- [ ] **项目骨架与依赖**　搭建根布局、导航、全局 Provider、首页外壳、404 和错误页。预装并锁定 Next.js、React、TypeScript、Tailwind、shadcn 常用组件、Postgres 驱动、Supabase Auth SDK、Vercel Blob SDK、Zod、`sharp`、Turbo SDK、`viem`、ZIP 库及 Vitest、Playwright Chromium、`@axe-core/playwright`、ESLint 和 secretlint。按附录 B 锁好 pnpm 与锁文件，启用 TS `strict` 和 `noUncheckedIndexedAccess`，设 `.gitattributes` 为 `* text=auto eol=lf`。预留 `src/app/`、`src/components/ui/`、`src/features/<ID>/` 与 `src/lib/`，在 `src/lib/adapters/` 中提供可选的 Mock 与测试网或沙箱实现，并纳入附录 B.2 指定的保护范围。
- [ ] **合约工具链**　地基在 `contracts/foundry.toml` 配置 Foundry 并固定 Foundry、Solidity 及 OpenZeppelin 版本。CI 的 `verify` 检查从 `contracts/` 目录运行 `forge test`，用本地链环境跑合约测试，无需 RPC 和钱包。板块 3 在 `contracts/` 下交付合约、测试和部署脚本。 [Foundry 项目配置](https://www.getfoundry.sh/config/index.html)
- [ ] **共享授权策略**　在地基保护路径 `src/lib/policy/content.ts` 提供唯一的纯函数，接收素材当前版本、发布或撤下状态、排除与用途授权，分别给出公开、私有导出、Arweave 和 NFT 的许可。所有业务入口使用这些结论。用表驱动 Vitest 覆盖普通获准、私有草稿、旧版本、撤下、明确不上链且可私下留存、禁止导出、拒绝歧义和历史批准对当前版本失效等组合。
- [ ] **共享契约、数据、权限**　在 `src/lib/contracts/` 固定第 4 节边界与样本。在 `src/lib/supabase/server.ts` 定义 Postgres 服务端入口，首行 `import "server-only"`，连接按运行身份配置。保留 `supabase/migrations/`、`supabase/seed.sql`、`e2e/fixtures/` 和生成的 `src/lib/database.types.ts`。建齐业务所需结构，新业务表默认开启 RLS，使用显式授予和收窄的策略，禁止 `USING (true)` 类全放开策略。网站和工作器各用必要的运行权限，数据库管理凭据只用于管理。验证游客、维护者和受限服务身份无法越权读取或写入，包括私有文件与合成样本隔离。地基同时提供 Supabase Auth 的服务端会话接入和 Blob 文件引用适配器的最小样板，由各业务板块提供各自的授权检查。
- [ ] **环境与 worktree**　`.env.example` 列齐变量名，每个一行用途，值留空。服务端启动时按环境和选定适配器校验字段组合，缺值时只报名称，禁止生产配置指向测试项目或 Preview 指向生产，开发和 CI 允许纯 Mock 无第三方凭据启动。`.ai/bin/setup-worktree.sh` 验证基线，从本机显式提供的文件或 `~/secrets/<项目名>.env.local` 复制到新目录的 `.env.local`，权限按手册限制，随后装锁定依赖。复制文件，无软链，不回显值；新 worktree 可直接 `pnpm verify`。本地 Windows 若 Turbopack 报错，在受影响的 Next.js 开发或构建命令上切换到 webpack，并记入地基备忘。
- [ ] **主题与仓库规则**　`src/app/globals.css` 以 `--color-*: initial;` 和 `--font-*: initial;` 清空默认色板和字体，在 `@theme inline` 映射语义 token，提供 `--font-heading`，初值用中性色。根 `DESIGN.md` 按 3.8，最多 40 行，具体值集中在 `globals.css`。`AGENTS.md` 按 3.1，项目规则用祈使句，保留 Next.js 托管区块，项目规则最多 65 行。实际使用的工具按需提供 `CLAUDE.md`（`@AGENTS.md`）、`GEMINI.md` 等仅指向根规则的兼容文件。按手册记录决策、卡点、“需要地基变更”和最多三次修复，PR 使用四节描述。
- [ ] **极简 `/debug`**　`src/app/debug/**` 与 `src/app/api/debug/**` 只在 `VERCEL_ENV=preview` 或显式 `development` 时开启。任务页和任务读取 API 再验应用维护者身份，未授权、生产或环境未识别返回 404。测试样本写入口同样检查环境，Bot 调用仅走测试交稿接口，Mock 调用检查样本权限。任务页只从任务表显示编号、时间、状态、简短原因。原邮件、附件、完整入参和凭据不得存入任务记录或出现在日志及 `/debug`；证据留在受权限保护的业务表。E2 先确认带 Vercel 放行头能到达应用，再验证无应用登录态为 404、维护者可见、Mock 样本身份无法访问真实测试任务；G2 验证有无登录态均为 404。 [Vercel 系统环境变量](https://vercel.com/docs/environment-variables/system-environment-variables) · [预览自动化放行](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
- [ ] **分支、合并与受保护路径**　D2 先建 `main-lock`，`stage-0` 是唯一地基线，发向 `main` 的草稿 PR，E2 由使用者用 merge commit 合入并切 `integration`。此后 `module/<ID>`、`fix/<ID>-<序号>`、`skin/<名称>`、`report/<日期>` 进 `integration` 用 squash。常规 PR 由工作流同步并复检，合并时按手册用 `gh pr merge --match-head-commit <审核SHA>` 绑定当前提交，行为在 E2/E3 实测。所有分支禁止 rebase、强推。G2 由使用者以 merge commit 从 `integration` 发布。附录 B.2 的扩展正则逐条写进 `.github/protected-paths.txt`，逐一补上适配器接口、选择逻辑、`ALLOW_MAINNET` 闸文件、`src/lib/policy/content.ts` 和 `contracts/foundry.toml`，保持 B.4 开关例外。首项目的 `.github/` 产物暂存 `stage0/github/`，按 E2 由使用者移入并推送。
- [ ] **`pnpm verify` 与零豁免**　顺序为 TypeScript、`eslint . --max-warnings 0`、Vitest。按 B.3 配 ESLint v9 Flat Config，使用 Next core-web-vitals 和 TypeScript 规则，设 `noInlineConfig: true`，禁显式 `any` 和 `@ts-ignore` 类指令。启用 `@shadcn/lint` 的 `no-raw-colors`、`no-arbitrary-values`、`no-inline-styles`、`no-restyle`，仅在 `e2e/**` 启用 Playwright 的 `no-skipped-test`、`no-focused-test`、`expect-expect`。`@shadcn/lint` 存在无法排除的误报时按 B.3 换 `eslint-plugin-better-tailwindcss` 并记录。`pnpm secrets` 用 secretlint 推荐预设及 B.3 排除项。错误信息说明如何修复。
- [ ] **锁定的验收测试**　用 `docs/modules.json` 预建各 ID 的 `e2e/acceptance/delivered/<ID>.json`，初始 `{"delivered": false}`；交付只打开本板块，首页健康始终运行。`e2e/acceptance/` 锁定五条黄金路径，对应本计划的地基首页与四个业务板块，`memorial` 用同一交付开关和一条从审核到公开的端到端路径，C4 写入 `docs/acceptance-script.md`，选择器使用第 2 节的可访问名称。`e2e/support/` 公共断言查页面异常、横向溢出和 WCAG 2A/2AA 的严重或关键 axe 问题，并保存整页截图供目检。桌面 1440×900、手机 390×844，CI 重试一次，HTML 与 JSON 报告，失败保留 trace。`BASE_URL` 未设时本地自动启动，预览 CI 须有可核验的 URL。业务调用走 Mock，测试持久样本在测试项目内按运行前缀写入及清理。开关核对脚本对每个 `true` 要求对应 spec 至少一条通过、零跳过，报告含部署提交号和两端结果。
- [ ] **快检与可信守卫**　`ci.yml` 用 `pull_request` 跑 `pnpm install --frozen-lockfile`、`pnpm verify`、`pnpm secrets`，Vercel 部署承担必过构建。`guard.yml` 按 B.5 用 `pull_request_target` 的目标分支版本，`contents: read`，只读取变更路径与开关 JSON，核对 PR 头 SHA，禁止执行 PR 的任何代码。除第 2 节允许追加的板块迁移外，拒绝受保护路径改动、开关增删或已开启开关关闭。检查来源和 PR 头 SHA 的绑定首次实测，无可信结果即不通过。地基改动由使用者核对后管理员放行，按 B.5 禁标签豁免。
- [ ] **预览 e2e、体检与生产只读**　`e2e.yml` 仅在 `deployment_status` 成功且环境为 `Preview` 时执行，检出部署 SHA，确认 URL 和项目归属，失配或缺失就失败。使用测试适配器并发布 Playwright 报告、截图、axe 与交付核对结果。`integration` 每次合并的测试预览用于该轮全量验收。涉及板块迁移时，先对合并 SHA 串行应用测试库迁移并核对数据库类型与权限，再运行该 SHA 的整体验收。失败按 3.5.3 通知、返修。`db-advisors.yml` 仅 `main` 定时或手动，以 `db-admin` 的测试配置链接项目并执行 `supabase db advisors --linked --type security --fail-on error`，迁移后也运行。`prod-readonly.yml` 由使用者在 G2 配置，只向正式站发只读请求，查首页、`/debug` 404、游客无法读私密内容并通知失败。生产只读检查无管理凭据与可写测试数据。
- [ ] **首次迁移，按 E2 和 B.5**　地基提交 `migrate.yml` 后，由使用者先将该工作流单独推到默认分支 `main`。`stage-0` 合入该更新，其余暂存工作流移到位，核对地基 PR 当前的完整提交号。由使用者从 `main` 手动触发 `migrate.yml`，在 `ref` 填已确认的当前提交 SHA；由 `main` 上的工作流在仅允许 `main` 的 `db-admin` 验证来源、固定测试项目，只读取该 SHA 的迁移、seed、类型文件，执行迁移与可重复 seed、生成并比对数据库类型，再跑体检。差异即失败，已执行迁移只追加，重跑先核对迁移状态。带管理凭据的 job 不执行 `ref` 里的应用或脚本。迁移后复核同一 SHA 的 CI、Vercel 预览和 `/debug`；提交变化重新取证，涉及迁移变动时按 B.5 重跑。草案阶段仓库尚无工作流与地基提交，`ref` 将取自 E2 已审核的地基 PR。
- [ ] **板块迁移与整体验收**　守卫按第 2 节仅放行新增、带本板块前缀的迁移，合并前的检查继续走 Mock 或本地测试。合并后，固定使用 `main` 上的可信工作流与仅测试的 `db-admin` 凭据，核对 `integration` 的已审合并 SHA，串行应用迁移、比对类型、核对 RLS 和角色权限并跑体检。地基维护者负责同步受保护的生成类型，核对通过后才开始该 SHA 的整体验收。带管理凭据的 job 只读取审核过的数据库文件，不执行该 SHA 中的应用或脚本。
- [ ] **规则集和交接报告**　`docs/stage0-report.md` 按 B.6 写清页面操作、待实测处和偏差。D1 暂用尚不存在的 `production`，授予机器账号写权限前用 `production-lock` 限制创建、更新和删除。D2 验 `main-lock` 后才邀请机器账号。E3 给 `integration` 配 PR、仅 squash、禁止删除和强推、允许自动合并，要求 `verify`、`guard`、`e2e` 和指定测试项目的 Vercel 检查。`main` 保留仅使用者可更新的限制，补齐必过检查、仅 merge commit。两条规则关闭 strict，绕过名单仅使用者。G2 正式项目切回 `main` 后解除临时分支限制。首次按 E3 演练红灯、改动或删除守卫、改锁定验收、数据库遗漏 RLS、新 worktree 和机器账号越权的情形。附录 B 中标为待验证的设置与事件关联，在 E2/E3 实测并记入 `docs/field-notes.md`。

**最小真实链路样板**　板块 0 在 `integration` 稳定测试预览提供测试接入。测试白名单成员发送三张合成或授权测试的手机原图 → 测试 Grok Bot 用独立令牌申请上传 → 附件直传测试私有 Blob，由 Contabo 工作器主动拉取并校验后保存到测试目录 → 按收件记录与文件指纹生成一条私有投稿 → 测试维护者点“查看样本”，刷新仍可见。重投不新增，损坏一件附件时可用响应编号在 `/debug` 查短原因。先在 CI 走 Mock，再由使用者按 E3 做一次真实测试投递。`intake` 在 E3 后复用该契约和适配器。

**自动验收的应用鉴权**　CI 凭 Vercel 放行密钥进入测试 Preview，再用仅在测试 Mock 模式可用的合成样本登录。真实维护者登录与会话由 Supabase Auth 管理。样本身份只操作每次运行独立命名空间内的合成内容，服务端对样本读写强制此边界，真实样本、维护者账号、Bot 入口、文件目录和链上适配器均不可达。每轮按 B.4 清理自己的样本。E2/E3 验证只有平台放行头时应用仍拒绝访问，样本身份不能跨空间或进入真实测试稿件，生产无样本入口。GitHub OIDC 和专用短时验收会话留待确有额外身份要求时再评估。

**上线交接**　F2 在同一 `integration` 预览确认四个业务板块，G1 按需调整呈现，业务代码仅改 `public`。G2 由使用者手动执行生产迁移，并核对测试与生产隔离、私密资源权限、`/debug` 与样本入口的生产 404、告警送达、磁盘 80% 告警和付费服务告警，再合并与部署。核对正式部署 SHA 后开启生产只读监控。

**G2 主网合约与合成图演练**　测试和评审通过后，由使用者开启生产执行闸和“OP 主网交易”开关，流程自动部署 OP 主网 ERC-721。付款钱包同时担任部署者、owner 和 minter。部署后核对链 ID、合约地址、owner、minter 与接收地址并验证合约源码。生产首次处理真实投稿前，由使用者单独批准一张不含真实投稿数据的合成图并开启真实 Arweave 写入，保持自动审批关闭。走真实 Turbo 上传，达到第 4 节确认条件后在 OP 主网铸一枚给已确认的接收地址，再由使用者在 SEMI App 验证显示。记录数据项 ID、交易哈希、tokenId、实际费用及显示结果，合成图不进入公开时间线。失败或结果未知时停发并核对原操作，由使用者收回执行闸。通过后同样撤除执行闸，后续真实操作按第 1 节单独放行。

## 4. 板块交接的数据格式

板块 0 提供 TypeScript 类型及 Zod 边界校验。HTTP JSON 带 `schemaVersion: 1`，ID 用字符串，时间用 UTC ISO 8601，站点日期用北京时间 `YYYY-MM-DD`，金额用最小计费单位的十进制整数字符串。原图与 ZIP 经私有 Blob 传输，展示图由网站媒体路由从 Blob 读取，契约只传文件引用。公开响应不含私有对象引用、发件人或历史版本。

| 生产方 → 消费方 | 契约和约束 |
| --- | --- |
| Bot → `intake` | `IntakeEventV1` 含 `eventId`（Grok 内部收件记录 ID）、自报 `sender`、`receivedAt`、`sourceMessageId?`、`sourceProof?`、`inReplyToId?`、`commonDateHint?`、`items[]`。每项包含类型、原始位置、日期和拒绝原句，以及照片 `attachmentRef` 或日记正文。上传文件引用保存 `objectKey`、`mediaType`、`sizeBytes`、`sha256`。照片一律提交原件，转换件由 Contabo 生成并保存独立引用。静态长期令牌仅可调用交稿接口的 `prepare` 及提交。上传凭证仅能写入绑定的 Blob 对象，工作器拉取后按登记值核对大小与 SHA-256。按 Bot 的内部记录 ID 和文件指纹去重，附件使用原始文件 SHA-256，日记使用正文指纹；同一记录只生成一条投稿，补件只添未入库条目。可选证据仅供追查。 |
| `intake` → `review` | `SubmissionDraft` 含投稿 ID、收件时间、发件与原句证据、条目和待办原因。每个条目提供素材 ID、版本、类型、日期结果及来源、私有文件或日记版本引用、排除状态与候选。相同文件指纹复用照片身份，疑似同图但指纹不同的交维护者核对。清理原邮件前核对证据、有效附件和关联已持久化。 |
| `review` → `permanent` | `ApprovalSnapshot` 绑定素材版本、站内发布与获批永久动作、批准时间和人工或自动来源。允许只归档，或在同次审批里同时放行归档及直接铸给接收方。NFT 授权绑定接收配置版本。领取与发送前按地基共享策略复核永久动作许可，再检查开关和接收配置。 |
| 工作器 → 后台及 `/debug` | `JobSummary` 只含任务 ID、时间、状态和短原因。状态为排队、执行中、完成、需处理；用原因区分余额不足、失败和结果待核对。内部用唯一操作键关联获准素材或照片 ID、动作和网络，保存 `OperationReceipt`。凭证记录数据项 ID 或交易哈希，以及核对需要的内容哈希、代币 ID 等。具体恢复与确定完成条件见下。 |
| `review` → `public` | `PublishedTimelineItem { itemId, currentVersionId, localDate, sortOrder, kind, title?, caption?, publicMediaRef?, diaryText?, focalPoint?, layoutRole? }`，照片可带尺寸及画面焦点，时间线可用分组与精选标记。`SitePresentation { heroMediaRef?, heroCopy?, anniversary: { monthDay?, headline?, copy?, heroMediaRef? } }`，纪念配置未设日期时自动选平日展示。`review` 写入发布状态和纪念日设置，`public` 按地基共享策略从当前发布状态派生公开视图和关联资源，私有引用、邮箱和历史版本不下发。 |
| 授权与发布 → `exports` | 维护者按需发起生成，只保存一个当前 ZIP 引用。独立调用共享策略的私有导出许可来选择当前内容，包括可私下留存且获准导出的不上链照片。`ExportManifest` 记录生成时间、来源版本、相对路径及校验值。串行生成，开始时关闭下载入口并覆盖唯一文件，在 Contabo 生成并完整上传到私有 Blob，且源内容仍符合导出授权时才开放下载。失败清理半成品。撤下、排除或导出授权变化时立即关闭下载并删除旧包及其 Blob 对象，同步作废受影响的在途生成。每次申请下载时检查维护者身份和当前 ZIP 的可下载状态，再签发该 ZIP 的绕过 Blob 缓存的短期直下链接。 |

**迁移覆盖**　用最少业务表覆盖投稿与条目、照片和日记版本、发布与授权、设置、任务及执行凭证、当前 ZIP 引用。待办原因与业务记录同存。用唯一约束与事务固定去重、批准版本、原子领取和撤下可见性。运行权限分为网站和一个受限工作器角色，后者只访问任务、执行所需输入和结果，在持有会话锁时领取和回写。游客由网站读公开投影，维护者由网站服务端鉴权。测试和生产在共用的 Supabase 项目内分别配置业务 schema、运行角色及权限，禁止测试运行角色跨读写生产业务表。先用现有运行边界，按任务再拆数据库角色或系统账号留到复用时评估。

**照片处理**　Grok 一律上传照片原件。照片只在 Contabo 解码与转换，保留 HEIC 原件。D1 用实际 iPhone HEIC 样本验证部署版 `sharp` 的 HEVC 解码，失败时使用带 libheif 与 HEVC 解码支持的 libvips，并用同批样本复测。按实际字节核验媒体格式，转换失败进待办。处理时校正方向、重编码并去除 EXIF、定位、设备和原文件名等信息。展示版保留高于永久副本的画质，由 Contabo 工作器发布到 Vercel Blob。永久副本单独压缩至 ≤100 KB，仅用于 Arweave。裁剪等改变画面的版本重新审核。NFT 元数据只含经审核的通用标题和永久图片引用。 [sharp 的 HEIC 支持](https://sharp.pixelplumbing.com/api-output/#heif)

**永久任务恢复**　工作器在专用 Postgres 会话上通过 `pg_try_advisory_lock` 获取固定的会话锁，拿到锁才使用同一会话串行领取和回写任务。连接采用直连或会话模式。连接中断时停止领取及发送新动作，重连取得锁后先恢复中断任务。先持久化已签名的完整数据项或原始交易及其 ID，再执行广播。重启或超时后先根据原 ID 核对，结果未知时禁止重新签发或另起操作，确认可重试时只用保存的同一签名产物。只有在 GraphQL 查到数据项、所属打包交易至少有 3 个区块确认，且网关取回的字节 SHA-256 与签名前记录的内容哈希一致时，才确认 Arweave 写入。随后才可铸造。用稳定照片 ID 的 SHA-256 派生 `tokenId`，签名前查链上是否已存在，由 ERC-721 拒绝重复 ID。重复提交、重新压缩、裁剪同一素材或改图注均不再铸造，凭证绑定照片身份。核对交易回执和接收方所有权后才确认 NFT。公开归档或 NFT 记录分别在各自确认后写入，站内获准照片的展示独立进行。 [PostgreSQL 会话锁](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS) · [Supabase 连接模式](https://supabase.com/docs/guides/database/connecting-to-postgres)

**日记加密格式**　数据库保留日记明文和私有历史。首次获准归档的公开修订加密上传，后续修订默认只更新数据库，单独批准才重新归档。站内回滚通过新修订恢复旧内容，并重新检查公开授权。Contabo 签名与上传服务用 Node 24.22.3（最低 24.13），以 Argon2id（64 MiB、3 轮、随机盐）派生 AES-256-GCM 密钥，每次使用独立随机 nonce。版本化 JSON 信封包含修订 ID、算法和 KDF 参数、盐、nonce、认证标签和密文。修订 ID 及格式和算法参数以确定性编码进入 AAD，密文只放获批修订的内容。写好信封后回读、解密并与获批修订校验，通过后才广播。口令采用猫名日常读音的普通话全拼连写，全小写，无声调、空格或连字符，ü 写作 `v`，加解密前以 NFC 规范化。D1 由使用者在受限配置中录入实际值。口令被猜中或泄露后，已取得的永久密文可能被解开。疑似泄露时暂停新归档，由使用者决定后续口令。 [Node.js Argon2 文档](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback)

## 5. 共用资源与所有权

| 共用资源 | 责任板块与使用方式 |
| --- | --- |
| 数据库迁移、RLS、seed、类型生成和体检 | `foundation` 负责共享结构、seed、类型生成和体检。板块只可追加自身前缀的迁移。板块迁移通过审查并合入 `integration` 后自动串行应用到测试库，核对类型与权限后跑整体验收。首次地基迁移由使用者在 `db-admin` 手动触发，生产迁移亦由使用者手动执行，不带测试 seed。 |
| 共享配置、环境、适配器接口、主题与验收 | `foundation` 拥有根布局、全局主题、依赖和共享契约。每块只提交自己的功能、测试与交付开关。G1 专轮经使用者审核调整主题和呈现，业务代码仅改 `public`。 |
| 测试收件来源、Bot 和接入令牌 | `intake` 长期负责，`foundation` 在 E3 的一次性样板先使用再交接，其他板块使用合成提交。测试与生产的入口、凭据、收件范围和白名单分别设置。 |
| 测试维护者、共享授权策略及纪念日配置 | `foundation` 拥有共享策略及单测，并在 E2/E3 使用测试维护者身份。`review` 负责测试维护者日常验收与纪念日配置，`public` 读取公开配置，`exports` 和 `permanent` 直接用共享策略。CI 仅用 Mock 样本登录。 |
| OP Sepolia RPC、测试币、测试钱包、合约与 ArLocal | `foundation` 拥有合约工具链配置，`permanent` 拥有合约实现、测试与部署脚本，并负责测试联调。其他板块使用 Mock。流程在测试和评审通过后自动部署测试网和主网合约。主网签名服务按 B.7 的本项目例外读取付款钱包私钥。 |
| Vercel Blob、Contabo 文件和 ZIP | `foundation` 提供共享文件契约。`intake` 负责原图，`review` 负责展示授权，`public` 负责从 Blob 提供展示图，`permanent` 负责永久副本，`exports` 负责当前 ZIP、删除与下载入口。测试和生产的 Blob 存储及 Contabo 目录分开，清理只对当轮测试数据执行。 |
| GitHub、Vercel、规则与通知 | `foundation` 规划交接。使用者管理云账号和开关，D3 接入 Cezar，G2 生效后按生产只读路径监控。 |

## 6. 需要提前配置的服务与凭据

**D1 前优先发起**

1. **GitHub 与 Vercel**　准备使用者管理员和专用机器账号，独立建测试与生产 Vercel 项目。将测试项目连仓库并生成 Preview 自动化放行密钥，安排稳定测试预览域名。生产项目开放正式环境前以不存在的 `production` 分支隔离，关闭生产项目的 PR 预览。D2/D3/E3 按第 3 节配置规则与 `db-admin`，实测 GitHub 必过检查只认指定测试预览。
2. **Supabase Postgres + Supabase Auth**　一个免费项目已就绪。D1 配置测试与生产各自的 schema 和应用运行角色。项目关闭开放注册，并由使用者为两个环境分别预建维护者账户。验证登录、会话、登出及测试身份无法进入生产后台。管理权限和迁移按第 3 节及 B.7。
3. **Grok 与现有邮箱**　设置独立测试与生产令牌，D1 由使用者私下把第一条白名单填入对应环境的服务端配置或数据库受限配置，首批仅使用者自己的一个邮箱，客户后续加入。冒烟 `prepare`、提交与重投，并用 iPhone HEIC 原件实测 Blob 直传、Contabo 主动拉取和解码。
4. **Vercel Blob 与 Contabo**　开发期使用 Vercel 默认域名，自定义域名购买延后到与客户确认之后。各建测试和生产私有 Blob 存储，准备分开的 Contabo 测试与生产目录、磁盘 80% 告警和 systemd 服务。签名与上传服务以现有 `agent` 用户运行，仅主动发起出站请求。D1 按第 1 节实测大陆访问速度及 Blob 免费额度。首版不做异地备份，也无需准备异地备份账号与凭据。不上链原图在清理 Blob 暂存件后只保存在 Contabo 的一块盘上，盘损坏时原图会丢失。
5. **Turbo 和 OP**　准备 ArLocal、OP Sepolia RPC、测试钱包和测试币。测试合约自动部署后，先在 OP Sepolia 铸一枚核对链上回执和所有权。准备 Alchemy 账号与独立的 OP Mainnet 项目，测试公共 RPC 不足时另开 Alchemy OP Sepolia 测试项目。准备供 OP 合约源码验证的 Etherscan API key、可取得 Base ETH 的渠道、Turbo 手动充值额度及 OP Gas。用现有通知通道配置 Turbo 低余额告警，D1 确定阈值，G2 核验送达。G2 前私下设置正式 OP 接收公钥、合约名称、签名材料及日记解档口令，并按第 3 节启用主网自动部署、完成演练。验证三个开关可分别启停。

**密钥落点**　按 B.7 仅在需要的运行层设置。示例变量包含 `DATABASE_URL`、`WORKER_DATABASE_URL`、`GROK_INTAKE_TOKEN`、`OP_RPC_URL` 和 `DIARY_ARCHIVE_PASSPHRASE`，值均在仓库外配置。数据库连接、口令、哈希、签名和访问令牌只在服务端使用。`NEXT_PUBLIC_` 只用于确需公开的非敏感配置。Contabo 上服务环境文件权限为 `0600`，钱包私钥存于 `agent` 的 `~/secrets/`，文件权限为 `0600`，路径与项目解耦。测试和开发 worktree 不存放生产材料。

| 项目 | 本机 `.env.local` | 服务器环境文件或服务配置 | Vercel Preview | GitHub Secrets / Environment | 生产落点 |
| --- | --- | --- | --- | --- | --- |
| 网站 Postgres 运行连接 | 测试，按需 | 开发仅测试，按需 | 测试，按需且仅服务端 | — | Vercel Production，仅服务端运行角色 |
| 工作器 Postgres 运行连接 | 测试，按需 | 测试工作器，按需 | — | — | Contabo 签名与上传服务的受限任务角色 |
| 测试网 RPC、测试钱包私钥、测试接收配置、ArLocal 参数 | 按需，测试币 | 测试服务 / 开发文件按需 | 按需，仅测试适配器 | — | 正式 OP RPC 与接收配置置于受限的生产服务配置，应用只存接收配置引用及版本 |
| Grok 静态长期令牌与白名单 | 测试服务端按需 | 测试 Bot 配置按需 | 仅在测试交稿接口验令牌，白名单置于私有配置 | — | 生产令牌仅在 Grok 安全配置及 Vercel Production，生产白名单仅在服务端或生产数据库的受限配置 |
| 维护者登录与 `/debug` | 共用 Auth 项目，按需使用测试维护者身份 | — | 共用 Auth 项目，应用只认测试维护者，CI 仅用合成样本身份 | — | 同一 Auth 项目，生产应用只认生产维护者；`/debug` 关闭 |
| Vercel Blob 存储访问 | 测试按需 | 工作器使用对应环境的 Blob 访问凭据 | 绑定测试 Blob 存储 | — | Vercel Production 绑定生产 Blob 存储，生产工作器持生产 Blob 访问凭据 |
| `db-admin` 的 Supabase 访问令牌、数据库密码、项目标识 | 密码本机受限留存 | — | — | 仅允许 `main` 的 `db-admin` Environment；自动迁移只允许测试 schema | 使用者掌握共用项目管理权限，生产迁移由使用者手动执行 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | — | — | 平台生成；若 Bot 联调也受平台拦截，其专用测试交付环境经授权使用测试放行值 | 仓库级唯一敏感例外，e2e 访问测试预览 | — |
| GitHub 机器账号经典令牌、AI CLI、Cezar、通知 | — | 机器账号仅 `repo` 无 `workflow`，限获邀仓库；以 `agent` 登录 AI CLI；Cezar 口令、通知令牌和 `chat_id` 在服务配置 | — | — | 正式只读监控使用维护者通知设置 |
| 发信服务 key | — | — | — | — | 首版无需申请 |
| Etherscan API key | — | — | — | — | 仅在 Contabo 的部署验证环境按需使用 |
| 主网 EVM 签名材料、解档口令与 `ALLOW_MAINNET` | — | 开发文件均无 | — | — | 钱包私钥按 B.7 的本项目例外置于 Contabo 上 `agent` 的 `~/secrets/`。口令和执行闸仅由使用者配置在签名与上传服务的受限环境 |

**B.7 的本项目例外**　Contabo 上的签名与上传服务与 Cezar、Codex 共用 `agent` 用户。主网付款钱包私钥放在 `agent` 的 `~/secrets/` 下，目录权限为 `0700`，私钥和服务环境文件权限为 `0600`。私钥路径与具体项目解耦，供将来其他项目共用同一钱包。正式执行程序和 systemd 配置由使用者部署，开发账号无写权限。私钥和口令不得进入仓库、工单、命令参数、日志、CI、PR 或开发备份。

**例外带来的风险**　夜间以 `agent` 运行的 AI 可以读取私钥。将来其他项目共用该钱包时，那些项目以 `agent` 运行的 AI 同样可以读取私钥。持有私钥即可绕开应用开关支出，直接资金损失以钱包余额为上限，包括泄露后转入的资金。同一把钥匙同时是部署者、owner 和 minter。私钥丢失或被盗后，旧合约失守，只能重新部署一份合约，已铸的 NFT 留在旧合约里。使用者已知晓并接受这些风险。共用钱包后，单个项目的错误、在途 nonce 冲突、资金占用或泄露也会波及其他共用项目。已确认的交易和永久写入无法撤回。仅按需入金，疑似泄露即停签并核对在途结果。解档口令暴露时还须暂停新归档、核查永久密文影响范围。

**B.7 的 Supabase 共用项目例外**　免费名额下，测试与生产共用一个 Supabase 项目，偏离附录 B.7 的独立项目要求。业务数据用独立 schema、运行角色、授予和 RLS 隔离。Auth 的用户目录与签发者共用，应用按环境明确匹配维护者身份。测试应用和开发 AI 只使用测试运行角色。项目级管理或迁移凭据仍可能接触生产数据，隔离不等同于两个项目。测试自动迁移在执行前核对目标并限制到测试 schema，生产迁移仍由使用者手动触发。D1 验证明文管理凭据的落点、跨 schema 拒绝和跨环境后台拒绝。

**B.7 其余约束**　CI 自动环境不设 `ALLOW_MAINNET`，仓库级 Secrets 除测试放行密钥外只允许不敏感值。`e2e` 会执行 PR 所部署版本的测试代码，能读到放行密钥是附录 B 已接受的测试范围风险。该密钥只放行 Vercel 平台，应用权限另验。生产运行凭据不会进入测试部署、开发环境或仓库级 Secrets，共用项目管理凭据按上面的例外管理。使用者持有平台和维护者管理权限，域名购买延后。

## 7. 技术选型问卷

下表记录本轮的已定方案和仍须验证的事项。账号、邮箱、钱包地址、真实猫名、白名单和密钥在 D1 或 G2 对应私下渠道配置。

| 题号 | 结论与待验证事项 |
| --- | --- |
| **T01 · Grok 交稿认证** | 静态长期令牌仅限交稿接口（含 `prepare` 和提交）。`prepare` 提供 Vercel Blob 的短期单对象上传凭证并限制大小，工作器拉取后核对 SHA-256。测试与生产用不同令牌。已在真实 Grok 验证长期令牌方式。 |
| **T02 · 发件人与白名单** | Grok 单独收件，网站最终判断白名单。Grok 只提供自报原始发件人，无法提供可核验的发件人证据，发件人可被冒充。原始 Message-ID 与来源证据字段可选，用 Grok 内部记录 ID 加文件指纹去重。前期逐封人工确认，使用者开启自动审批即视为接受此风险。白名单按第 6 节私下维护。若以后需要经验证的邮件来源，考虑带 DMARC 判定的域名入站服务（例如 SES），首版不接入。 |
| **T03 · 工作器位置与身份** | Contabo 上 systemd 常驻拉取 Supabase 任务和 Blob 原图，Contabo 不开放公网入口。与 Cezar、Codex 共用 `agent` 用户，钱包私钥放在 `agent` 的 `~/secrets/` 下，与项目路径解耦，私钥文件权限为 `0600`。 |
| **T04 · Arweave 及费用** | 用 Turbo，手动以 Base ETH 充值。同一 EVM 私钥签数据项并支付 OP Gas，两链分别备余额。105 KiB 单项门槛和 10 MiB 终身免费总量见第 1 节。原生 AR 钱包与 `arweave-js` 仅作备选。 |
| **T05 · OP RPC、配额与测试隔离** | OP Sepolia 默认使用公共 RPC 和测试币，公共 RPC 不足时切换到独立的 Alchemy OP Sepolia 项目。CI 用 Mock。生产用独立的 Alchemy OP Mainnet 项目，确认额度与告警。共用 Supabase 项目的测试 schema 仅放合成数据或授权测试素材，每轮测试用运行前缀隔离。生产数据位于生产 schema，由独立运行角色访问。 |
| **T06 · ERC-721 和接收方** | 自写 ERC-721，部署 OP，由使用者私下提供接收公钥，直接铸入其地址。流程在测试和评审通过后自动部署 OP Sepolia 和 OP 主网合约，每个环境用本环境的一把 EVM 私钥担任部署者、owner 和 minter，owner 可更换 minter。主网部署还须由使用者启用“OP 主网交易”开关和生产执行闸。测试网部署后先铸一枚 NFT 核对链上结果，再按第 3 节的 G2 演练在 SEMI App 验证主网显示。 |
| **T07 · 域名和平台账户** | 使用者持有平台账户，开发账号仅获所需仓库访问。开发期用 Vercel 默认域名，自定义域名等客户确认后再购买。 |
| **T08 · 自动验收应用鉴权** | 保留原方案的最小权限、样本隔离、部署 SHA 核对和平台与应用双层验证。首版用第 3 节的 Mock 样本登录跑自动验收，真实维护者用 Supabase Auth 登录和会话。GitHub OIDC 和短期专用验收会话降为备选。 |
| **T09 · 照片、ZIP 和测试隔离** | Vercel Blob 接收原图、存放展示图并提供私有 ZIP 下载，D1 实测大陆访问速度与免费额度。Contabo 工作器主动拉取原图，校验落盘后可删除 Blob 暂存件。Contabo 100 GB 磁盘在 80% 占用时告警。原图、展示版、永久副本和 ZIP 分开，Supabase 只存数据库记录。首版不做异地备份，不上链原图在 Blob 暂存件清理后只有 Contabo 本地一份，磁盘损坏会丢失。测试和生产的 Blob 存储与本地目录分开，每轮自动验收只清理自己的合成样本。 |
| **T10 · 持续自动期如何管理生产执行闸？** | G2 首次按手册人工打开、验证并撤除。进入持续自动期时，由使用者再次显式授权在签名与上传服务的生产配置中保留 `ALLOW_MAINNET`，停用时撤除。三项业务开关始终可独立切换，自动审批不设过期。若选择维持 G2 的临时运行方式，站内自动审批照常记授权，真实任务排队等待下一次人工打开执行闸。 |
| **T11 · 异常自动刹车** | 延后，待逐封人工运行积累数据再决定。首版仍保留余额不足暂停、异常转人工和人工关停。 |
| **T12 · 正式故障与交付通知走哪个通道？** | 优先复用使用者已配置的 Cezar 通道，未配置则验证 Telegram Bot 可达。只向维护者发送部署标识、任务编号和短原因。投稿缺件留站内待办，由维护者自己联系。 |

## 8. 使用者对评审的决定

1. **文件入口**　Grok 经网站 `prepare` 取得短期上传凭证，将原图直传 Vercel Blob。Contabo 工作器主动拉取并校验落盘，之后可删除 Blob 上的原图，展示图发布到 Vercel Blob，Contabo 不开放任何公网入口，D1 实测大陆访问速度及免费额度。
2. **后台登录**　采用 Supabase Auth 自带的登录和会话，关闭开放注册。两环境共享 Auth 用户目录，各预建一个维护者账户，各自后台按环境匹配身份。
3. **邮件**　Grok 单独收件，首版不接 Cloudflare 入站，Grok 的令牌仅用于交稿接口。Grok 给不出可核验的发件人证据，发件人可被冒充，前期来信一律人工确认，使用者开启自动审批即视为接受这一风险。
4. **维护与公开**　`memorial` 的实现拆为维护、审核和撤下的 `review`，以及公开页面和媒体的 `public`，仍一起交付。保留从审核到公开的端到端验收，G1 的业务代码仅改 `public`。
5. **数据库迁移**　板块仅可追加带自身前缀的迁移，审查通过并合入 `integration` 后自动串行应用到测试库，核对数据库类型和权限后跑整体验收。此处偏离附录 B.5 的“迁移由使用者手动触发”做法，需要同步修订工作流手册，放宽仅限测试库的后续板块迁移，首次地基迁移和生产迁移仍由使用者手动执行。
6. **自动审批**　自动审批没有每日数量限制，符合条件的 Grok 投稿按已启用的开关与执行闸自动永久写入、铸造和空投。拒绝、授权不明、要求更改接收钱包地址、钱包余额不足或结果未知的相应动作转人工。

## 8. 方案确认

使用者于 2026-11-24 确认本方案，随后明确三项调整。开发期使用 Vercel 默认域名，域名购买等客户确认。测试与生产共用一个已开通的免费 Supabase 项目，按 schema 和运行角色隔离。首版不做异地备份，相关风险和待验证项见第 6 节。
