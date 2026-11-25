# 永久归档与 NFT 决定记录

## 3.1 · MemorialPhotos（memorial-erc721-v1）

- `setMinter` 只接受非零地址，零地址回滚为 `InvalidMinter()`。这能阻止误把有效铸造身份替换为不可用地址。当前 owner 可再次调用 `setMinter`，恢复先前的非零 minter。
- 构造时发出 `MinterChanged(address(0), deployer)`，轮换时发出 `MinterChanged(previousMinter, next)`，让索引和审查能从部署回执开始追踪铸造权限。恢复先前 minter 会产生新事件，已确认的历史事件仍可查阅。
- 使用 OpenZeppelin 的 `_safeMint`，避免把 NFT 铸给不支持 ERC-721 接收协议的合约。接收地址由审批绑定。合约接收方会在 URI 写入前收到回调，此时可看到 token 已归其所有，但读取的 URI 为空。回调拒绝或回滚会回滚整笔铸造。工作器在成功回执后读取 URI 与所有权，并在签名前预演同一接收地址。
- 保留 `Ownable.transferOwnership`，使管理权可以交接。交接完成后只有新 owner 能转回管理权或轮换 minter，当前 minter 不随 owner 一同变更。`renounceOwnership` 始终回滚为 `OwnershipRenunciationDisabled()`，避免主动放弃管理权后永久失去轮换能力。有效管理地址的控制权丢失仍会使轮换无法进行。

合约部署后，以上字节码行为无法在原址修改。如需调整，须按计划 3.1 审核新产物，并在允许重新部署的环境中显式递增部署版本（例如 `memorial-erc721-v2`）。新合约地址独立，既有代币和历史留在原合约。首版主网地址冻结，任何在途且结果未知的部署仍须按原部署键核对。

## 3.1 · OP Sepolia 工作器接线

测试工作器只在受保护部署脚本安装的
`/srv/memorial-worker/test/releases/<完整 SHA>` 内运行部署适配器。运行目录、模块所在
发布目录和 `test/current` 必须解析到同一发布目录。RPC URL 仍由共享测试配置读取。

运维发布器在核对受保护的 `integration` 合并、对应独立评审、可信迁移证明和完整验收后，
从同一 SHA 按锁定工具链重建 `MemorialPhotos.json` 并比较发布文件的全部字节。只有这些检查
通过，才原子安装 root 所有、工作器可读且组和其他用户不可写的
`/etc/memorial-worker/op-sepolia-release.json`。上级目录也必须由 root 控制。清单包含：

- `release` 使用共享 `TestDeploymentRelease` 字段。环境为 `test`，分支为
  `integration`，链 ID 为 11155420，`reviewedSha`、`releaseSha`、`migrationSha` 和
  `acceptanceSha` 都是实际发布的完整合并 SHA。 `artifactHash` 是完整 JSON 文件的
  SHA-256 小写十六进制（无前缀）。
- `config` 依次包含 `version`、`name`、`symbol`、`deployer`、`gasLimit`、
  `maxFeePerGas`、`maxPriorityFeePerGas`、`maxTotalFee`、`rpcUrlHash`。
  `version` 是审核的配置 UUID，必须等于 `release.constructorConfigVersion`。
  `deployer` 是小写含前缀的非零地址。四个限额是十进制正整数字符串，费用均以 wei 计。
  `rpcUrlHash` 是共享配置中的精确 RPC URL 字符串的 SHA-256（无前缀）。
- `configHash` 是按上述字段顺序对配置执行 `JSON.stringify` 后的 UTF-8 SHA-256
  （无前缀）。构造参数、部署账户、RPC URL 或限额修改后，需要新审核及新配置 UUID。
  任何在途部署必须先完成核对。新发布与旧部署键冲突时沿用旧凭证。

签名服务由运维在 root 控制的 `/run/memorial-test-signer/deploy.sock` 提供，只允许
专用测试工作器连接。HTTP `POST /sign-op-sepolia-deployment` 接收
`{sha, unsignedTransaction}`，返回 HTTP 200 和纯文本小写原始签名交易。服务必须独立
核对该 SHA 的当前授权、固定测试账户、链 ID、部署数据、空接收地址、零转账值、nonce 和费用
限制，且只签名。签名器须使用独占 OP Sepolia 测试账户。运维可通过移除清单或停用签名器
关停新部署。当前仓库提供工作器接线和该接口约定，发布清单生成器及测试签名服务由受信运维提供。

工作器检查 EIP-1559 的 gas、费用和余额，并在费用预算中计入 OP L1 费用估算及 operator
fee。OP 费用估算会随出块参数变化，交易中实际编码的硬限制是 gas limit、max fee 和
max priority fee。广播前持久化原始签名交易和发送尝试状态。恢复时按交易哈希查询，按回执
区块核对代码、owner 和 minter。处于 `signed` 且尚无发送尝试的交易可在重新核查后进行首次
发送。处于 `unknown` 时只对账，即使节点无记录也停留在原 nonce 和凭证。工作器本次轮询
用完后保留运行状态，由已有启动恢复重新领取。发现 nonce 冲突或回执不符时转人工核对。
恢复时保留原发布配置和 SHA。跨发布恢复须先由运维核对原凭证，测试适配器只处理精确发布。

本步以合成签名器和 RPC 验证。实际 ArLocal、铸造和完整永久交付验收留待下一独立任务。

## 3.2 · ArLocal 归档及一次测试铸造

工作器插座接受 `permanent.archive-photo` 版本 1，任务载荷只含 `itemId`。
`execute.ts` 消费可选的服务端 `permanentPhoto` 上下文。未接线或环境非
`test` 时，入口只记录短原因。沙箱 URI 是仅含通用名称和 `ar://<id>` 图像引用的
JSON 数据 URI。ArLocal 使用原生格式 2 交易，签名和网关都严格限制在本机测试实例
的工作流内。ArLocal 通过交易状态返回所在区块和确认计数，达到三次确认后回读 JPEG
并核对 SHA-256。付费 Turbo 和真实永久写入继续由 G2 控制。

签名及发送各有一次独立的审批复读。照片派生读取当前获批版本的私有文件引用，
输出单帧、方向已校正的 JPEG，最多 100,000 字节。已确认归档可供同素材另行批准的裁剪
复用。当前版本授权、固定接收配置和部署证据须在测试铸造时仍一致。
铸造只用链 ID 11155420，按持久化交易哈希核对成功回执和该回执区块的所有者及 URI。
`attempted` 即使暂时查不到回执也只对账；记发送尝试和发出请求之间如果中断，也保留
原凭证和 nonce 供人工核对。

### 测试专用决定（可逆）

- 决定：测试沙箱铸造的 token URI 用只含通用名称和 `ar://<id>` 图像引用的 JSON 数据 URI；归档与铸造仅在环境为 `test` 且上下文由服务端注入时执行，ArLocal 返回 HTTP 200 的纯文本 `Pending` 视为未确认并继续等待。
- 理由：docs/plan.md 允许在测试沙箱用合成签名者、回环 ArLocal 和一次性链验证，不需要真实账号、密钥或邮件，也不产生生产写入。数据 URI 不含真实身份、任务参数或原图。
- 备选：把元数据另行上传到 ArLocal，再引用其 `ar://` 地址。它多出一次不可逆写入和一个待核对对象，当前验收只需要核对图像和铸造，故不采用。
- 回退：只改 `execute.ts` 中的 URI 生成函数及其测试即可切换；没有链上或永久写入需要撤回。生产、主网、付费 Turbo 和永久交付开关保持关闭，不受此决定影响。
- 须维护者决定（must_human 范围，本步未代决）：受保护的调度、审批读取、凭证存储与运维授权的接入（见下节），以及正式环境的元数据格式。

### 需要地基与受信运维接入

1. 地基调度器从测试审批事件创建带稳定身份绑定的任务，或者从同一审批事务的 outbox 领取。
   按审核事件及动作去重，再按照片身份去重外部操作。现有测试工作器数据库 INSERT 策略
   只允许 `permanent.deploy-contract`，需要精确追加归档类型和载荷约束。限制为
   `test_worker`，禁止 Web 更改、生产领取及样本队列混用。持久绑定至少包含
   `jobId, itemId, stablePhotoId`，撤下后仍可用该绑定领取历史凭证。
2. 在共享 `WorkerContext` 接入 `PhotoWorker`。在同一次数据库读取中提供
   `PermanentApprovalState`、照片类型、不可变版本的私有文件引用及稳定照片身份。
   使用可信摄取身份贯穿版本和同素材衍生关系，为旧照片回填稳定 ID。当前审批缺失、撤销、
   排除或被行级权限隐藏时关闭新写入。文件读取绑定经过验证的本地原件；现有 Blob 入口
   需要补充该本地读取能力。任务载荷不携带文件路径或审批。
3. 共享操作存储为 `(test, stablePhotoId, archive, arlocal)` 和
   `(test, stablePhotoId, mint, op-sepolia)` 分别提供唯一记录。沿用部署存储的数据库会话锁
   和条件更新语义。为照片收据补充专用约束或受限表，记录签名原文、派生 ID、来源版本、
   图像摘要或审核铸造意图及 nonce。签名原文只允许测试工作器读取。签名、尝试、确认三步
   分别落库，使用不可变凭证和单向状态条件更新。发送前读回凭证，确认时原子写入
   `confirmed_at`。测试签名者锁与部署共享，核算同签名者其余未结算预留，任一未知操作
   阻断新签名。解锁或数据库连接断开应中止待发请求。测试调度器按退避重新领取待核对
   记录并保留短原因；只恢复原操作键。网站只读受限状态投影。
4. 运维通过共享测试配置提供回环 ArLocal、一次性 RSA 签名器、回环测试 RPC 和合成
   OP Sepolia 签名服务。提供独立于任务载荷的审查发布 SHA、已确认部署哈希、部署者、
   nonce、合约地址与运行时代码哈希。固定接收地址、配置版本、测试签名人和费用限额
   同一份授权，签名服务再对所收到的 EIP-1559 调用及 nonce 做独立校验。关闭开关或
   撤销配置后只提供对账；同一笔已发送交易继续使用原收据中的意图。测试 RPC
   端点之外的签名和广播接线需要运维单独授权。

### 验证命令

- `corepack pnpm install --frozen-lockfile`
- `corepack pnpm verify`
- `corepack pnpm exec vitest run src/features/permanent`
- `corepack pnpm e2e e2e/features/permanent`
- `corepack pnpm e2e`，然后 `corepack pnpm exec tsx e2e/support/check-delivered.ts`
- `forge test --root contracts`
- 在工作树外临时目录安装 `arlocal@1.1.66`，运行
  `corepack pnpm exec tsx src/features/permanent/run-arlocal.ts /absolute/path/to/node_modules/arlocal`。
  此夹具启动真实回环 ArLocal，生成并充值一次性测试钱包，从应用任务入口派生并归档，
  落盘签名凭证后读取它来恢复上下文，并用合成 OP Sepolia RPC 验证仅一次铸造。
- F2 在地基接线后从受保护测试工作器重做审批到到账。部署核对仍按计划运行
  `corepack pnpm exec tsx src/features/permanent/verify-deployment.ts --network op-sepolia`；
  当前基线没有该 3.1 CLI，应由部署交付补齐，并用受信发布的已知凭证核对。

### 待维护者决定（needs-human）

**决定事项**　是否安排地基所有者和受信运维单独交付上述测试接线，并将该接线列为 §3.2 交付与 F2 验收的前置条件。建议批准。正式元数据格式留待正式交付决策，本次可继续使用已记录的沙箱数据 URI。

**阻塞依据**　集成祖先为 `e0839c7943190ad8eb35c9f5e5fd705618dfa07c`，本次记录前的工作树 HEAD 为 Cezar 自动保存的 `d55821207912c3e223c135ea7235f11e04e5f687`。该提交已有模块任务入口和夹具。共享工作器未注入 `permanentPhoto`，测试角色的任务插入策略只专门放行了 `permanent.deploy-contract`。因此应用任务入口在夹具中可执行，现行受保护工作器仍无法从实际审批领取照片归档任务并持久化签名凭证。接线涉及共享工作器、授权读取、队列与凭证数据库权限、受信发布配置。仓库禁区也列有当前草稿改动的 `src/features/permanent/jobs.ts`。计划 §共享契约允许 E3 后由所有者实现处理器，须由维护者通过现有受信流程确认该改动能否按现行 guard 交付。若 guard 要求地基所有者处理，由其在同一接线任务中接管插座。

**事件与验证**　Cezar 事件日志序号 604 记录了实现步的回环 ArLocal 签名、发送、三次确认与 SHA-256 回读，以及一次合成 OP Sepolia 铸造。此前运行的 `pnpm verify`、全量 Playwright 和 Forge 分别报告 131、14 和 8 个测试通过。实现步的手工提交因 `index.lock` 写权限失败，后续 Cezar 自动保存已留下上述本地提交。事件 612、700、703 分别记录 `need_decision`、`must_human` 和 `needs-human`。此前测试是草稿工作树证据，本记录步未重跑，最终交付仍需同一完整 SHA 的独立评审、检查与预览。F2 的只读部署核对 CLI 也仍缺失。

**批准后**　由地基所有者交付测试审批事务到任务入队、当前版本与稳定照片身份读取、归档和铸造凭证的唯一键与条件更新、退避恢复及只读摘要。受信运维按同一审核发布配置提供回环 ArLocal、合成签名器和绑定的 OP Sepolia 测试部署证据。由部署交付补齐只读凭证核对 CLI。保留现有草稿，从实际审批与工作器入口用合成数据验证关闭时无写入、确认后一次到账、撤下拦截、重复与并发去重和重启对账，再按上节命令为待交付 SHA 重取证。

**若拒绝或暂缓**　保留 `fix/permanent-5` 的草稿与合成夹具证据，将 §3.2 的工作器集成和 F2 永久交付项标为待办，批次继续独立且不依赖该接线的板块和验收。永久交付、生产、主网及付费 Turbo 保持关闭。后续批准时从已保存草稿恢复并重新取证。
