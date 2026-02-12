import type { SuiClient, SuiEvent, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import { readMoveStringOrVector } from "@sui-oracle-market/tooling-core/utils/formatters"
import {
  requireValue,
  tryParseBigInt
} from "@sui-oracle-market/tooling-core/utils/utility"
import type { AcceptedCurrencySummary } from "./currency.ts"
import { getAcceptedCurrencySummaries } from "./currency.ts"
import type { DiscountTemplateSummary } from "./discount.ts"
import { getDiscountTemplateSummaries } from "./discount.ts"
import type { ItemListingSummary } from "./item-listing.ts"
import { getItemListingSummaries } from "./item-listing.ts"

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
  name: string
  disabled: boolean
}

export type ShopCreatedSummary = {
  shopId: string
  ownerAddress?: string
  name?: string
  ownerCapId?: string
  createdAtMs?: string
  txDigest?: string
}

const parseShopCreatedEvent = (
  event: SuiEvent
): ShopCreatedSummary | undefined => {
  try {
    if (
      !event.parsedJson ||
      typeof event.parsedJson !== "object" ||
      Array.isArray(event.parsedJson)
    )
      return undefined
    const fields = event.parsedJson as Record<string, unknown>
    const shopId = normalizeOptionalIdFromValue(fields.shop_id)
    if (!shopId) return undefined

    return {
      shopId,
      ownerAddress: normalizeOptionalIdFromValue(fields.owner),
      name: readMoveStringOrVector(fields.name),
      ownerCapId: normalizeOptionalIdFromValue(fields.shop_owner_cap_id),
      createdAtMs: event.timestampMs ? String(event.timestampMs) : undefined,
      txDigest: event.id?.txDigest
    }
  } catch {
    return undefined
  }
}

export const getShopCreatedSummaries = async ({
  shopPackageId,
  suiClient,
  pageSize = 50,
  maxPages = 10
}: {
  shopPackageId: string
  suiClient: SuiClient
  pageSize?: number
  maxPages?: number
}): Promise<ShopCreatedSummary[]> => {
  const normalizedPackageId = normalizeIdOrThrow(
    shopPackageId,
    "Shop package ID is required."
  )
  const eventType = `${normalizedPackageId}::shop::ShopCreatedEvent`
  const summaries: ShopCreatedSummary[] = []
  const seen = new Set<string>()
  let cursor: Parameters<SuiClient["queryEvents"]>[0]["cursor"]

  for (let page = 0; page < maxPages; page += 1) {
    const response = await suiClient.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      limit: pageSize,
      order: "descending"
    })

    for (const event of response.data) {
      const summary = parseShopCreatedEvent(event)
      if (!summary || seen.has(summary.shopId)) continue
      seen.add(summary.shopId)
      summaries.push(summary)
    }

    if (!response.hasNextPage || !response.nextCursor) break
    cursor = response.nextCursor
  }

  return summaries
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
  const name = getShopNameFromObject(object)
  const disabled = getShopDisabledFlagFromObject(object)

  return {
    shopId,
    ownerAddress,
    name,
    disabled
  }
}

export const getShopNameFromObject = (object: SuiObjectData): string => {
  const shopFields = unwrapMoveObjectFields<{ name?: unknown }>(object)
  return readMoveStringOrVector(shopFields.name) ?? "Unnamed Shop"
}

export const getShopDisabledFlagFromObject = (
  object: SuiObjectData
): boolean => {
  const shopFields = unwrapMoveObjectFields<{ disabled?: unknown }>(object)
  const rawDisabled = shopFields.disabled
  return Boolean(rawDisabled as boolean)
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
      const fields = unwrapMoveObjectFields<{ shop_id: unknown }>(object)
      const shopIdField = normalizeOptionalIdFromValue(fields.shop_id)
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
      const fields = unwrapMoveObjectFields<{ shop_id: unknown }>(object)
      const shopIdField = normalizeOptionalIdFromValue(fields.shop_id)
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

export type ShopSnapshot = {
  shopOverview: ShopOverview
  itemListings: ItemListingSummary[]
  acceptedCurrencies: AcceptedCurrencySummary[]
  discountTemplates: DiscountTemplateSummary[]
}

export const getShopSnapshot = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ShopSnapshot> => {
  const [shopOverview, itemListings, acceptedCurrencies, discountTemplates] =
    await Promise.all([
      getShopOverview(shopId, suiClient),
      getItemListingSummaries(shopId, suiClient),
      getAcceptedCurrencySummaries(shopId, suiClient),
      getDiscountTemplateSummaries(shopId, suiClient)
    ])

  return {
    shopOverview,
    itemListings,
    acceptedCurrencies,
    discountTemplates
  }
}
