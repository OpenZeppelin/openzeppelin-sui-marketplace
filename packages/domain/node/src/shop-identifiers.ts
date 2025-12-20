import type {
  ShopIdentifierInputs,
  ShopIdentifiers
} from "@sui-oracle-market/domain-core/models/shop"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"

export const resolveLatestShopIdentifiers = async (
  providedIdentifiers: ShopIdentifierInputs,
  networkName: string
): Promise<ShopIdentifiers> => {
  const [shopArtifact, ownerCapArtifact] = await Promise.all([
    getLatestObjectFromArtifact("shop::Shop", networkName),
    getLatestObjectFromArtifact("shop::ShopOwnerCap", networkName)
  ])

  return {
    packageId: normalizeIdOrThrow(
      providedIdentifiers.packageId ?? shopArtifact?.packageId,
      "A shop package id is required; publish the package first or provide --shop-package-id."
    ),
    shopId: normalizeIdOrThrow(
      providedIdentifiers.shopId ?? shopArtifact?.objectId,
      "A shop id is required; create a shop first or provide --shop-id."
    ),
    ownerCapId: normalizeIdOrThrow(
      providedIdentifiers.ownerCapId ?? ownerCapArtifact?.objectId,
      "An owner cap id is required; create a shop first or provide --owner-cap-id."
    )
  }
}

export const resolveLatestArtifactShopId = async (
  providedShopId: string | undefined,
  networkName: string
): Promise<string> => {
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  return normalizeIdOrThrow(
    providedShopId ?? shopArtifact?.objectId,
    "A shop id is required; create a shop first or provide --shop-id."
  )
}
