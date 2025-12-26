import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  normalizeIdOrThrow,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  requireValue,
  tryParseBigInt
} from "@sui-oracle-market/tooling-core/utils/utility"

export type ShopIdentifierInputs = {
  packageId?: string
  shopId?: string
  ownerCapId?: string
}

export type ShopIdentifiers = {
  packageId: string
  shopId: string
  ownerCapId: string
}

export const parseUsdToCents = (rawPrice: string): bigint => {
  const normalized = rawPrice.trim()
  if (!normalized) throw new Error("Price is required.")

  const decimalMatch = normalized.match(/^(\d+)(?:\.(\d{0,2}))?$/)
  if (!decimalMatch) {
    const asInteger = tryParseBigInt(normalized)
    if (asInteger < 0n) throw new Error("Price cannot be negative.")
    return asInteger
  }

  const dollars = decimalMatch[1]
  const fractional = (decimalMatch[2] || "").padEnd(2, "0")

  return BigInt(dollars) * 100n + BigInt(fractional)
}

/**
 * Formats a USD cents string into a displayable dollar amount.
 */
export const formatUsdFromCents = (rawCents?: string) => {
  if (!rawCents) return "Unknown"
  try {
    const cents = BigInt(rawCents)
    const dollars = cents / 100n
    const remainder = (cents % 100n).toString().padStart(2, "0")
    return `$${dollars.toString()}.${remainder}`
  } catch {
    return "Unknown"
  }
}

export type ShopOverview = {
  shopId: string
  ownerAddress: string
}

export const getShopOwnerAddressFromObject = (
  object: SuiObjectData
): string => {
  const shopFields = unwrapMoveObjectFields<{ owner: unknown }>(object)
  return requireValue(
    normalizeOptionalAddress(shopFields.owner as string | undefined),
    "Shop object is missing an owner address field."
  )
}

export const getShopOverview = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ShopOverview> => {
  const { object } = await getSuiObject(
    { objectId: shopId, options: { showContent: true, showType: true } },
    { suiClient }
  )
  const ownerAddress = getShopOwnerAddressFromObject(object)

  return {
    shopId,
    ownerAddress
  }
}

/**
 * Resolves the ShopOwnerCap object ID owned by a specific address for a shop.
 */
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
  const normalizedShopId = normalizeIdOrThrow(shopId, "Shop ID is required.")
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
