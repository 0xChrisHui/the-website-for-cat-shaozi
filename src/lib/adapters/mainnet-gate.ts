export function assertMainnetAllowed(config: {
  instance: string;
  executionRole: string;
  allowMainnet: string | undefined;
  ci: boolean;
}) {
  if (config.ci || config.instance !== "prod" || config.executionRole !== "signer" || config.allowMainnet !== "true") {
    throw new Error("ALLOW_MAINNET");
  }
}
