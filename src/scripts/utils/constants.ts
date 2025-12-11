import { normalizeSuiObjectId } from "@mysten/sui/utils"
import os from "node:os"
import path from "node:path"

export const ONE_SUI = 1_000_000_000n
export const MINIMUM_GAS_COIN_BALANCE = ONE_SUI
export const MINIMUM_GAS_COIN_OBJECTS = 3
export const MINIMUM_ACCOUNT_BALANCE = MINIMUM_GAS_COIN_BALANCE * 5n
export const DEFAULT_TX_GAS_BUDGET = 100_000_000

export const DEFAULT_KEYSTORE_PATH = path.join(
  os.homedir(),
  ".sui",
  "sui_config",
  "sui.keystore"
)

export const getArtifactPath =
  (artifactType: "mock" | "deployment" | "object") => (network: string) =>
    path.join(process.cwd(), "deployments", `${artifactType}.${network}.json`)

export const getDeploymentArtifactPath = getArtifactPath("deployment")
export const getObjectArtifactPath = getArtifactPath("object")

export const SUI_CLOCK_ID = normalizeSuiObjectId(
  "0x0000000000000000000000000000000000000000000000000000000000000006"
)

// ID of the shared CoinRegistry object.
export const SUI_COIN_REGISTRY_ID = normalizeSuiObjectId(
  "0x000000000000000000000000000000000000000000000000000000000000000c"
)
