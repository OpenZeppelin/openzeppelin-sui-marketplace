import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  getAllOwnedObjectsByFilter,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"

export const resolveOwnerCapabilityId = async ({
  shopId,
  shopPackageId,
  ownerAddress,
  suiClient
}: {
  shopId: string
  shopPackageId: string
  ownerAddress: string
  suiClient: SuiClient
}): Promise<string> => {
  const ownerCapabilityType = `${shopPackageId}::shop::ShopOwnerCap`
  const normalizedShopId = normalizeIdOrThrow(
    shopId,
    "Shop ID is required."
  )
  const normalizedOwnerAddress = normalizeSuiAddress(ownerAddress)

  const ownerCapabilityObjects = await getAllOwnedObjectsByFilter(
    {
      ownerAddress: normalizedOwnerAddress,
      filter: { StructType: ownerCapabilityType },
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const ownedCapabilitySummaries = ownerCapabilityObjects.map((object) => {
    try {
      const fields = unwrapMoveObjectFields<{
        shop_address?: unknown
        shop_id?: unknown
      }>(object)
      const shopIdField = normalizeOptionalIdFromValue(
        fields.shop_address ?? fields.shop_id
      )
      return {
        objectId: object.objectId,
        shopId: shopIdField
      }
    } catch (error) {
      return {
        objectId: object.objectId,
        shopId: undefined,
        parseError: error instanceof Error ? error.message : String(error)
      }
    }
  })

  const matchingCapability = ownerCapabilityObjects.find((object) => {
    try {
      const fields = unwrapMoveObjectFields<{
        shop_address?: unknown
        shop_id?: unknown
      }>(object)
      const shopIdField = normalizeOptionalIdFromValue(
        fields.shop_address ?? fields.shop_id
      )
      return shopIdField === normalizedShopId
    } catch {
      return false
    }
  })

  if (!matchingCapability) {
    const error = new Error(
      "No ShopOwnerCap found for this shop. Ensure the owner capability is in your wallet."
    )
    error.cause = {
      ownerAddress: normalizedOwnerAddress,
      shopId: normalizedShopId,
      ownerCapabilityType,
      ownedCapabilities: ownedCapabilitySummaries
    }
    throw error
  }

  return normalizeIdOrThrow(
    matchingCapability.objectId,
    "No ShopOwnerCap found for this shop. Ensure the owner capability is in your wallet."
  )
}
