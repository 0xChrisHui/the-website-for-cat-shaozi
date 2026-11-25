import { testDeploymentReleaseSchema, type TestDeploymentRelease, type TestDeploymentReleaseSource } from "@/lib/contracts/permanent";

export async function readTestDeploymentRelease(source: TestDeploymentReleaseSource) {
  const evidence = testDeploymentReleaseSchema.safeParse(await source.readVerifiedRelease());
  if (!evidence.success) return null;
  const release = evidence.data;
  if (release.reviewedSha !== source.workerSha || release.releaseSha !== source.workerSha ||
      release.migrationSha !== source.workerSha || release.acceptanceSha !== source.workerSha ||
      release.artifactHash !== source.artifactHash ||
      release.constructorConfigVersion !== source.constructorConfigVersion) return null;
  return release;
}

export async function enqueueTestDeployment(
  scope: "test" | "prod",
  source: TestDeploymentReleaseSource,
  enqueue: (release: TestDeploymentRelease) => Promise<string | null>,
): Promise<string | null> {
  if (scope !== "test") return null;
  const release = await readTestDeploymentRelease(source);
  return release ? enqueue(release) : null;
}
