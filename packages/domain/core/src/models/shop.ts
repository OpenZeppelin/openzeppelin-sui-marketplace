import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import {
  getSuiObject,
  normalizeOptionalAddress,
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
