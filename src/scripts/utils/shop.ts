import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { readArtifact, writeArtifact } from "./artifacts.ts"
import { getObjectArtifactPath } from "./constants.ts"
import type { NetworkName } from "./types.ts"

export type ShopObjectArtifact = Partial<{
  packageId: string
  publisherId: string
  shopId: string
  shopOwnerCapId: string
  shopInitialSharedVersion?: number | string
  shopOwnerAddress?: string
  digest?: string
}>

const normalizeOptionalId = (value?: string) =>
  value ? normalizeSuiObjectId(value) : value

const normalizeSharedVersion = (value?: number | string) =>
  value === undefined ? value : Number(value)

const normalizeShopArtifact = (
  artifact: ShopObjectArtifact
): ShopObjectArtifact => ({
  ...artifact,
  packageId: normalizeOptionalId(artifact.packageId),
  publisherId: normalizeOptionalId(artifact.publisherId),
  shopId: normalizeOptionalId(artifact.shopId),
  shopOwnerCapId: normalizeOptionalId(artifact.shopOwnerCapId),
  shopInitialSharedVersion: normalizeSharedVersion(
    artifact.shopInitialSharedVersion
  )
})

const DEFAULT_ARTIFACT: ShopObjectArtifact = {}

/**
 * Reads the shop object artifact for a network, creating an empty baseline when missing.
 */
export const readShopObjectArtifact = async (
  network: NetworkName
): Promise<ShopObjectArtifact> =>
  readArtifact<ShopObjectArtifact>(
    getObjectArtifactPath(network),
    DEFAULT_ARTIFACT
  )

/**
 * Writes the shop object artifact to disk after normalizing IDs and shared versions.
 */
export const writeShopObjectArtifact = async (
  network: NetworkName,
  artifact: ShopObjectArtifact,
  options: { artifactPath?: string } = {}
): Promise<{ artifactPath: string; artifact: ShopObjectArtifact }> => {
  const targetPath = options.artifactPath ?? getObjectArtifactPath(network)
  const normalizedArtifact = normalizeShopArtifact(artifact)

  const merged = await writeArtifact<ShopObjectArtifact>(DEFAULT_ARTIFACT)(
    targetPath,
    normalizedArtifact
  )

  return { artifactPath: targetPath, artifact: merged }
}
