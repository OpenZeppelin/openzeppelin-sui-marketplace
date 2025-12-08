import path from "node:path";
import os from "node:os";

export const DEFAULT_KEYSTORE_PATH = path.join(
  os.homedir(),
  ".sui",
  "sui_config",
  "sui.keystore"
);

export const getArtifactPath =
  (artifactType: "mock" | "deployment") => (network: string) =>
    path.join(process.cwd(), "deployments", `${artifactType}.${network}.json`);

export const getDeploymentArtifactPath = getArtifactPath("deployment");
export const getMockArtifactPath = getArtifactPath("mock");
