import { describe, expect, it, vi } from "vitest";
import { enqueueTestDeployment } from "./permanent-release";
import type { TestDeploymentRelease } from "@/lib/contracts/permanent";

const sha = "a".repeat(40);
const release: TestDeploymentRelease = {
  environment: "test", branch: "integration", chainId: 11155420,
  reviewedSha: sha, releaseSha: sha, migrationSha: sha, acceptanceSha: sha,
  artifactHash: "b".repeat(64), constructorConfigVersion: "1e5086c5-327a-46c4-9d81-a80af616bc21",
  deploymentVersion: "memorial-erc721-v1",
};

describe("trusted deployment release intake", () => {
  const runtime = {
    workerSha: sha, artifactHash: release.artifactHash,
    constructorConfigVersion: release.constructorConfigVersion,
  };

  it("queues a verified release without needing a queued job", async () => {
    const enqueue = vi.fn().mockResolvedValue("job-id");
    const readVerifiedRelease = vi.fn().mockResolvedValue(release);
    await expect(enqueueTestDeployment("test", { ...runtime, readVerifiedRelease }, enqueue)).resolves.toBe("job-id");
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(release);
  });

  it.each([
    null, { ...release, environment: "prod" }, { ...release, branch: "main" },
    { ...release, chainId: 10 }, { ...release, reviewedSha: "c".repeat(40) },
    { ...release, migrationSha: "c".repeat(40) }, { ...release, acceptanceSha: "c".repeat(40) },
    { ...release, releaseSha: "c".repeat(40) }, { ...release, artifactHash: "c".repeat(64) },
    { ...release, constructorConfigVersion: "fdd45da3-010d-4799-9cac-1ed84084433e" },
  ])("rejects missing or mismatched evidence without writing", async (evidence) => {
    const enqueue = vi.fn();
    const readVerifiedRelease = vi.fn().mockResolvedValue(evidence);
    await expect(enqueueTestDeployment("test", { ...runtime, readVerifiedRelease }, enqueue)).resolves.toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not consult a provider or write on production", async () => {
    const enqueue = vi.fn();
    const readVerifiedRelease = vi.fn().mockResolvedValue(release);
    await expect(enqueueTestDeployment("prod", { ...runtime, readVerifiedRelease }, enqueue)).resolves.toBeNull();
    expect(readVerifiedRelease).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
