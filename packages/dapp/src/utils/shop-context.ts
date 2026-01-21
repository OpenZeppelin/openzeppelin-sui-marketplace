import {
  resolveLatestArtifactShopId,
  resolveLatestShopIdentifiers
} from "@sui-oracle-market/domain-node/shop"

export const resolveOwnerShopIdentifiers = async ({
  networkName,
  shopPackageId,
  shopId,
  ownerCapId
}: {
  networkName: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
}) =>
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
