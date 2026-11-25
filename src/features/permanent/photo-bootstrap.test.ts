import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { getContractAddress, keccak256 } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bindPhotoRelease } from "./photo-bootstrap";
import { photoRecipientVersion } from "./mint";
import { sha256 } from "./reconcile";

it("independently binds the current integration release and an older approved deployment", () => {
  const workerSha = "a".repeat(40);
  const deployedSha = "b".repeat(40);
  const rpc = "https://rpc.example.invalid";
  const chainId = 11155420;
  const rpcUrlHash = sha256(rpc);
  const deployer = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as `0x${string}`;
  const recipient = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  const recipientVersion = photoRecipientVersion(recipient)!;
  const release = (sha: string) => ({
    environment: "test", branch: "integration", chainId,
    releaseSha: sha, reviewedSha: sha, migrationSha: sha, acceptanceSha: sha,
  });
  const fee = { gasLimit: "100", maxFeePerGas: "2", maxPriorityFeePerGas: "1", maxTotalFee: "300" };
  const config = { version: recipientVersion, name: "Synthetic", symbol: "TEST", deployer, ...fee, rpcUrlHash };
  const artifact = readFileSync(new URL("../../../contracts/script/MemorialPhotos.json", import.meta.url));
  const manifest = {
    release: { ...release(deployedSha), artifactHash: sha256(artifact),
      constructorConfigVersion: config.version, deploymentVersion: "memorial-erc721-v1" },
    config, configHash: sha256(JSON.stringify(config)),
  };
  const txHash = keccak256("0x01");
  const address = getContractAddress({ from: deployer, nonce: 1n }).toLowerCase();
  const input = {
    release: { ...release(workerSha), rpcUrlHash },
    archive: { endpoint: "http://127.0.0.1:1984", syntheticKeyHash: sha256("key"),
      syntheticOriginals: [sha256("photo")], rewardLimit: "20" },
    mint: {
      ...fee, recipientVersion, recipient,
      deployment: { reviewedSha: deployedSha, manifest,
        receipt: { txHash, address, nonce: 1, owner: deployer, minter: deployer } },
    },
  };

  expect(bindPhotoRelease(input, workerSha, rpc, artifact)?.policy).toMatchObject({
    recipient, recipientVersion, sender: deployer, deployment: { reviewedSha: deployedSha, txHash, address },
  });
  expect(bindPhotoRelease(input, deployedSha, rpc, artifact)).toBeNull();
  expect(bindPhotoRelease(input, workerSha, rpc + "/changed", artifact)).toBeNull();
  expect(bindPhotoRelease(input, workerSha, rpc, Buffer.concat([artifact, Buffer.from(" ")]))).toBeNull();
  expect(bindPhotoRelease({ ...input, mint: null }, workerSha, rpc)?.policy).toBeNull();
  const changedRecipient = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  expect(bindPhotoRelease({ ...input, mint: { ...input.mint, recipient: changedRecipient } },
    workerSha, rpc, artifact)).toBeNull();
  input.mint.deployment.reviewedSha = workerSha;
  expect(bindPhotoRelease(input, workerSha, rpc, artifact)).toBeNull();
});
