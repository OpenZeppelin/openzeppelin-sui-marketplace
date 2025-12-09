import path from "node:path";
import os from "node:os";
import { NetworkName } from "./types";

export const DEFAULT_KEYSTORE_PATH = path.join(
  os.homedir(),
  ".sui",
  "sui_config",
  "sui.keystore"
);

export const getArtifactPath =
  (artifactType: "mock" | "deployment") => (network: NetworkName) =>
    path.join(process.cwd(), "deployments", `${artifactType}.${network}.json`);

export const getDeploymentArtifactPath = getArtifactPath("deployment");
