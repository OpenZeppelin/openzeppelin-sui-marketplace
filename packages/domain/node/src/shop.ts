import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type {
  ShopIdentifierInputs,
  ShopIdentifiers
} from "@sui-oracle-market/domain-core/models/shop"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import {
  findLatestArtifactThat,
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact,
  isPublishArtifactNamed,
  loadDeploymentArtifacts
} from "@sui-oracle-market/tooling-node/artifacts"

export const resolveMaybeLatestShopIdentifiers = async (
  providedIdentifiers: ShopIdentifierInputs,
  networkName: string
): Promise<Partial<ShopIdentifiers>> => {
  const [
    latestPublishedShopPackage,
    latestShopArtifact,
    latestOwnerCapArtifact
  ] = await Promise.all([
    getLatestDeploymentFromArtifact("sui_oracle_market")(networkName),
    getLatestObjectFromArtifact("shop::Shop")(networkName),
    getLatestObjectFromArtifact("shop::ShopOwnerCap")(networkName)
  ])

  const isShopFromLatestPublishedPackage =
    latestPublishedShopPackage?.packageId === latestShopArtifact?.packageId

  return {
    packageId: normalizeIdOrThrow(
      providedIdentifiers.packageId ?? latestShopArtifact?.packageId,
      "A shop package id is required; publish the package first or provide --shop-package-id."
    ),
    shopId: isShopFromLatestPublishedPackage
      ? normalizeIdOrThrow(
          providedIdentifiers.shopId ?? latestShopArtifact?.objectId,
          "A shop id is required; create a shop first or provide --shop-id."
        )
      : undefined,
    ownerCapId: isShopFromLatestPublishedPackage
      ? normalizeIdOrThrow(
          providedIdentifiers.ownerCapId ?? latestOwnerCapArtifact?.objectId,
          "An owner cap id is required; create a shop first or provide --owner-cap-id."
        )
      : undefined
  }
}

export const resolveLatestShopIdentifiers = async (
  providedIdentifiers: ShopIdentifierInputs,
  networkName: string
): Promise<ShopIdentifiers> => {
  const latestShopIdentifier = await resolveMaybeLatestShopIdentifiers(
    providedIdentifiers,
    networkName
  )

  return {
    packageId: normalizeIdOrThrow(
      providedIdentifiers.packageId ?? latestShopIdentifier?.packageId,
      "A shop package id is required; publish the package first or provide --shop-package-id."
    ),
    shopId: normalizeIdOrThrow(
      providedIdentifiers.shopId ?? latestShopIdentifier?.shopId,
      "A shop id is required; create a shop first or provide --shop-id."
    ),
    ownerCapId: normalizeIdOrThrow(
      providedIdentifiers.ownerCapId ?? latestShopIdentifier?.ownerCapId,
      "An owner cap id is required; create a shop first or provide --owner-cap-id."
    )
  }
}

export const resolveLatestArtifactShopId = async (
  providedShopId: string | undefined,
  networkName: string
): Promise<string> => {
  const shopArtifact =
    await getLatestObjectFromArtifact("shop::Shop")(networkName)

  return normalizeIdOrThrow(
    providedShopId ?? shopArtifact?.objectId,
    "A shop id is required; create a shop first or provide --shop-id."
  )
}

export const isOracleMarketPublishArtifact =
  isPublishArtifactNamed("sui_oracle_market")

export const resolveShopPackageId = async ({
  networkName,
  shopPackageId
}: {
  networkName: string
  shopPackageId?: string
}): Promise<string> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestShopPublishArtifact = findLatestArtifactThat(
    isOracleMarketPublishArtifact,
    deploymentArtifacts
  )

  return normalizeIdOrThrow(
    shopPackageId ?? latestShopPublishArtifact?.packageId,
    "A shop package id is required; publish the package or provide --shop-package-id."
  )
}

export const resolveShopDependencyIds = async ({
  networkName,
  shopPackageId
}: {
  networkName: string
  shopPackageId: string
}): Promise<string[]> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const match = deploymentArtifacts.find(
    (artifact) =>
      normalizeSuiObjectId(artifact.packageId) ===
      normalizeSuiObjectId(shopPackageId)
  )

  return (match?.dependencies ?? []).map((dependency) =>
    normalizeSuiObjectId(dependency)
  )
}

export const resolvePriceInfoPackageId = async ({
  priceInfoObjectId,
  suiClient
}: {
  priceInfoObjectId: string
  suiClient: SuiClient
}): Promise<string> => {
  const priceInfoObject = await suiClient.getObject({
    id: priceInfoObjectId,
    options: { showType: true }
  })

  const objectType = priceInfoObject.data?.type
  if (!objectType)
    throw new Error(
      `Pyth PriceInfoObject ${priceInfoObjectId} is missing a Move type.`
    )

  if (!objectType.includes("::price_info::PriceInfoObject"))
    throw new Error(
      `Object ${priceInfoObjectId} is not a Pyth PriceInfoObject (type: ${objectType}).`
    )

  return deriveRelevantPackageId(objectType)
}

export const assertPriceInfoObjectDependency = async ({
  priceInfoObjectId,
  dependencyIds,
  suiClient
}: {
  priceInfoObjectId: string
  dependencyIds: string[]
  suiClient: SuiClient
}) => {
  if (dependencyIds.length === 0) return

  const priceInfoPackageId = await resolvePriceInfoPackageId({
    priceInfoObjectId,
    suiClient
  })

  if (dependencyIds.includes(priceInfoPackageId)) return

  throw new Error(
    `Pyth PriceInfoObject ${priceInfoObjectId} belongs to package ${priceInfoPackageId}, which is not a dependency of the published shop package. Re-publish the Move package with the current Pyth dependency or update the Pyth config to match the on-chain package.`
  )
}
