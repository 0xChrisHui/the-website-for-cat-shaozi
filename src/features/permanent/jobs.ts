import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import { permanentDeploymentKind, type TestDeploymentReleaseSource } from "@/lib/contracts/permanent";
import { executeDeployment, waitForDeployment } from "./deploy";
import { createDeploymentRpc, signDeployment } from "./deployment-io";
import { readDeploymentConfig } from "./deployment-release";

export function createDeploymentReleaseSource(): TestDeploymentReleaseSource {
  return {
    workerSha: "",
    artifactHash: "",
    constructorConfigVersion: "",
    async readVerifiedRelease() {
      const config = await readDeploymentConfig();
      if (!config) return null;
      const { release } = config.bound;
      this.workerSha = config.workerSha;
      this.artifactHash = release.artifactHash;
      this.constructorConfigVersion = release.constructorConfigVersion;
      return release;
    },
  };
}

export async function handleJob(job: JobInput, context: WorkerContext): Promise<void> {
  if (job.kind !== permanentDeploymentKind || job.schemaVersion !== 1 || !context.permanent) {
    await context.jobs.finish(job.jobId, "处理器尚未交付");
    return;
  }
  const config = await readDeploymentConfig();
  if (!config) {
    await context.jobs.finish(job.jobId, "测试部署证据或签名器配置缺失");
    return;
  }
  const locked = await context.permanent.withDeployment(job.jobId, async (deployment) => {
    const result = await executeDeployment(deployment, {
      release: config.bound,
      rpc: createDeploymentRpc(config.rpcUrl),
      sign: (unsigned) => signDeployment(config.workerSha, unsigned),
      async authorized() {
        const current = await readDeploymentConfig();
        return current?.bound.configHash === config.bound.configHash &&
          JSON.stringify(current.bound.release) === JSON.stringify(config.bound.release);
      },
      wait: waitForDeployment,
    });
    if (result.done) await context.jobs.finish(job.jobId, result.reason);
  });
  if (!locked) throw new Error("Deployment lock unavailable");
}
