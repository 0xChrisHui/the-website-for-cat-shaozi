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

## F3 · Test photo recipient binding and recovery

Use the UUIDv8 returned by `photoRecipientVersion` in `src/features/permanent/mint.ts` for the reviewed
OP Sepolia recipient. It derives from SHA-256 of `memorial:test:11155420:photo-recipient:` followed by
the lowercase address, with the UUID version and variant bits set. Install that UUID in the photo release
manifest, the fixed signer's recipient allowlist and `test.photo-permanent.recipientVersion` while the
gates are closed. Legacy arbitrary UUIDs require a new manual approval before new mint execution.
Allowlist the same lowercase address and continue verifying the decoded mint destination at the signer.
The existing `POST /sign-op-sepolia-photo` request and response formats still apply.

The worker checks stored receipts before send authorization. An attempted mint may replay once from the
bound job if the original hash is absent, latest and pending nonces still match the signed nonce, and
the current approval, release and fee checks pass. The worker records that replay on the original job
and sends the original EIP-1559 bytes. Their hash, sender and nonce are identical. A pending hash,
a consumed nonce or an exhausted replay leaves the worker polling the original receipt. An attempted
ArLocal archive also remains lookup-only because this release has no verified duplicate-upload guarantee.
If an outcome remains unknown, the operator must inspect the original ArLocal journal or OP transaction
and nonce. Preserve the signed artifact and nonce reservation during this investigation. A stale approval
or legacy recipient binding on a staged artifact also requires operator review before it can proceed.
