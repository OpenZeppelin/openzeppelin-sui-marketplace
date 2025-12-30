import type {
  ShopIdentifierInputs,
  ShopIdentifiers
} from "@sui-oracle-market/domain-core/models/shop"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import {
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact
} from "@sui-oracle-market/tooling-node/artifacts"

export const resolveLatestShopIdentifiers = async (
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
