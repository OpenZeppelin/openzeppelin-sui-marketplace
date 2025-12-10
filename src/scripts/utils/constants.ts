import path from "node:path";
import os from "node:os";
import { normalizeSuiObjectId } from "@mysten/sui/utils";

export const DEFAULT_KEYSTORE_PATH = path.join(
  os.homedir(),
  ".sui",
  "sui_config",
  "sui.keystore"
);

export const getArtifactPath =
  (artifactType: "mock" | "deployment" | "object") => (network: string) =>
    path.join(process.cwd(), "deployments", `${artifactType}.${network}.json`);

export const getDeploymentArtifactPath = getArtifactPath("deployment");
export const getObjectArtifactPath = getArtifactPath("object");

export const SUI_CLOCK_ID = normalizeSuiObjectId(
  "0x0000000000000000000000000000000000000000000000000000000000000006"
);

// ID of the shared CoinRegistry object.
export const SUI_COIN_REGISTRY_ID = normalizeSuiObjectId(
  "0x000000000000000000000000000000000000000000000000000000000000000c"
);
