#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

# Exclude ambient RPC, compiler, profile and remapping overrides.
clean_env=(env -i "PATH=$PATH" "HOME=$HOME" "FOUNDRY_CONFIG=$root/foundry.toml")
for tool in forge cast; do
    version=$("${clean_env[@]}" "$tool" --version)
    if [[ ${version%%$'\n'*} != "$tool Version: 1.10.0" ]]; then
        printf 'Expected %s v1.10.0\n' "$tool" >&2
        exit 1
    fi
done

build_dir=$(mktemp -d)
trap 'rm -rf -- "$build_dir"' EXIT

"${clean_env[@]}" forge build --root "$root" \
    --out "$build_dir" --no-cache src/MemorialPhotos.sol >&2

artifact="$build_dir/MemorialPhotos.sol/MemorialPhotos.json"
creation=$(jq -er '.bytecode.object | select(test("^0x([0-9a-f]{2})+$"))' "$artifact")
runtime=$(jq -er '.deployedBytecode.object | select(test("^0x([0-9a-f]{2})+$"))' "$artifact")
creation_hash=$("${clean_env[@]}" cast keccak "$creation")
runtime_hash=$("${clean_env[@]}" cast keccak "$runtime")

jq -S --arg creationHash "$creation_hash" --arg runtimeHash "$runtime_hash" '
    {
        abi,
        creationBytecode: .bytecode.object,
        creationBytecodeHash: $creationHash,
        runtimeBytecode: .deployedBytecode.object,
        runtimeBytecodeHash: $runtimeHash
    }
' "$artifact"
