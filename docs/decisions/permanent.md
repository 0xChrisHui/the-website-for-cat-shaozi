# 永久归档与 NFT 决定记录

## 3.1 · MemorialPhotos（memorial-erc721-v1）

- `setMinter` 只接受非零地址，零地址回滚为 `InvalidMinter()`。这能阻止误把有效铸造身份替换为不可用地址。当前 owner 可再次调用 `setMinter`，恢复先前的非零 minter。
- 构造时发出 `MinterChanged(address(0), deployer)`，轮换时发出 `MinterChanged(previousMinter, next)`，让索引和审查能从部署回执开始追踪铸造权限。恢复先前 minter 会产生新事件，已确认的历史事件仍可查阅。
- 使用 OpenZeppelin 的 `_safeMint`，避免把 NFT 铸给不支持 ERC-721 接收协议的合约。接收地址由审批绑定。合约接收方会在 URI 写入前收到回调，此时可看到 token 已归其所有，但读取的 URI 为空。回调拒绝或回滚会回滚整笔铸造。工作器在成功回执后读取 URI 与所有权，并在签名前预演同一接收地址。
- 保留 `Ownable.transferOwnership`，使管理权可以交接。交接完成后只有新 owner 能转回管理权或轮换 minter，当前 minter 不随 owner 一同变更。`renounceOwnership` 始终回滚为 `OwnershipRenunciationDisabled()`，避免主动放弃管理权后永久失去轮换能力。有效管理地址的控制权丢失仍会使轮换无法进行。

合约部署后，以上字节码行为无法在原址修改。如需调整，须按计划 3.1 审核新产物，并在允许重新部署的环境中显式递增部署版本（例如 `memorial-erc721-v2`）。新合约地址独立，既有代币和历史留在原合约。首版主网地址冻结，任何在途且结果未知的部署仍须按原部署键核对。
