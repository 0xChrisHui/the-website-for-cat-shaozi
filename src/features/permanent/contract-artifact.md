# Memorial ERC-721 deployment and mint interface

For deployment version `memorial-erc721-v1`, build the trusted release checkout with Foundry v1.10.0, Solidity 0.8.30, and the vendored OpenZeppelin Contracts v5.4.0. The protected Foundry configuration enables optimization with 200 runs and sets the metadata bytecode hash to `none`. From the repository root:

```bash
set -e
artifact=$(mktemp)
trap 'rm -f -- "$artifact"' EXIT
contracts/script/inspect-memorial-photos.sh > "$artifact"
diff -u contracts/script/MemorialPhotos.json "$artifact"
```

The inspection command requires Bash, Forge, Cast and jq. It builds into a fresh temporary directory and emits the ABI, creation bytecode, runtime bytecode, and their Keccak-256 hashes. The hashes are over the decoded bytecode bytes. `creationBytecodeHash` excludes constructor arguments. `runtimeBytecodeHash` covers the complete deployed code, which has no constructor-dependent immutable substitutions or library links.

- `creationBytecodeHash` = `0x95ad1b7f84c4796343f11bd496b258c051614a8775727ba6e1f3d0a7b19f810c`
- `runtimeBytecodeHash` = `0x6fad566529ae7c976f19501d4e1e491113c660f7dd234ed762887238b9cfd290`

- **Deploy** with `constructor(string name_, string symbol_)`. Use `abi` and `creationBytecode` from the rebuilt artifact with viem's `encodeDeployData` and the reviewed constructor arguments in that order. Bind the approved constructor configuration separately from the creation bytecode hash. Immediately after deployment, `owner()` and `minter()` must both equal the address that executed contract creation. Compare the Keccak-256 hash of the receipt address's code against `runtimeBytecodeHash`.
- **Set the minter** with `setMinter(address next)` from the current owner. The next address must be nonzero. Rotation emits `MinterChanged(address indexed previousMinter, address indexed newMinter)` and immediately replaces the previous minter. Deployment emits the same event with a zero previous minter. `transferOwnership(address)` transfers administration alone. `renounceOwnership()` always reverts with `OwnershipRenunciationDisabled()`.
- **Mint** with `mint(address to, uint256 tokenId, string tokenUri)` from the current minter. Pass the approved recipient explicitly, the stable photo-derived ID as `bigint`, and the URI for approved public metadata with a neutral asset name. A contract recipient's ERC-721 callback runs before the URI is stored. A rejected callback rolls back the mint. A zero recipient or a previously minted ID reverts. Verify the successful receipt, `Transfer(address(0), to, tokenId)`, `ownerOf(tokenId)`, and `tokenURI(tokenId)`.

The build is local. Release authorization, signing, broadcast and reconciliation belong to the reviewed worker.
