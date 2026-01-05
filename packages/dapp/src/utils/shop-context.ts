import {
  resolveLatestArtifactShopId,
  resolveLatestShopIdentifiers
} from "@sui-oracle-market/domain-node/shop"

export type OwnerShopContextInput = {
  networkName: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
}

export const resolveOwnerShopIdentifiers = async ({
  networkName,
  shopPackageId,
  shopId,
  ownerCapId
}: OwnerShopContextInput) =>
  resolveLatestShopIdentifiers(
    {
      packageId: shopPackageId,
      shopId,
      ownerCapId
    },
    networkName
  )

export const resolveShopIdOrLatest = (
  shopId: string | undefined,
  networkName: string
) => resolveLatestArtifactShopId(shopId, networkName)
