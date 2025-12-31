import type {
  ShopIdentifierInputs,
  ShopIdentifiers
} from "@sui-oracle-market/domain-core/models/shop"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import {
  findLatestArtifactThat,
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact,
  isPublishArtifactNamed,
  loadDeploymentArtifacts,
  resolvePublisherCapIdFromObjectArtifacts
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

export const resolveShopPublishInputs = async ({
  networkName,
  shopPackageId,
  publisherCapId
}: {
  networkName: string
  shopPackageId?: string
  publisherCapId?: string
}): Promise<{ shopPackageId: string; publisherCapId: string }> => {
  const deploymentArtifacts = await loadDeploymentArtifacts(networkName)
  const latestShopPublishArtifact = findLatestArtifactThat(
    isOracleMarketPublishArtifact,
    deploymentArtifacts
  )

  const resolvedShopPackageId = normalizeIdOrThrow(
    shopPackageId ?? latestShopPublishArtifact?.packageId,
    "A shop package id is required; publish the package or provide --shop-package-id."
  )

  const publisherCapIdFromArtifacts =
    latestShopPublishArtifact?.publisherId ??
    (await resolvePublisherCapIdFromObjectArtifacts({
      networkName,
      publishDigest: latestShopPublishArtifact?.digest
    }))

  const resolvedPublisherCapId = normalizeIdOrThrow(
    publisherCapId ?? publisherCapIdFromArtifacts,
    "A publisher cap id is required; publish the package or provide --publisher-cap-id."
  )

  return {
    shopPackageId: resolvedShopPackageId,
    publisherCapId: resolvedPublisherCapId
  }
}
