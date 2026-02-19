import type {
  SuiClient,
  SuiObjectData,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import {
  getAllDynamicFields,
  getSuiDynamicFieldObjectByName
} from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  formatOptionalNumericValue,
  readMoveStringOrVector
} from "@sui-oracle-market/tooling-core/utils/formatters"
import { normalizeBigIntFromMoveValue } from "@sui-oracle-market/tooling-core/utils/move-values"
import { formatTypeNameFromFieldValue } from "@sui-oracle-market/tooling-core/utils/type-name"

const ITEM_LISTING_ADDED_EVENT_TYPE_SUFFIX = "::shop::ItemListingAddedEvent"

export type ItemListingDetails = {
  itemListingId: string
  markerObjectId?: string
  name?: string
  itemType: string
  basePriceUsdCents?: string
  stock?: string
  spotlightTemplateId?: string
}

export type ItemListingSummary = ItemListingDetails & {
  markerObjectId: string
}

const normalizeListingIdFromValue = (value: unknown) => {
  const parsedListingId = normalizeBigIntFromMoveValue(value)
  if (parsedListingId === undefined || parsedListingId < 0n) return undefined
  return parsedListingId.toString()
}

const normalizeListingIdOrThrow = (value: unknown, errorMessage: string) => {
  const listingId = normalizeListingIdFromValue(value)
  if (!listingId) throw new Error(errorMessage)
  return listingId
}

const resolveListingsTableId = async (shopId: string, suiClient: SuiClient) => {
  const { object: shopObject } = await getSuiObject(
    {
      objectId: shopId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const shopFields = unwrapMoveObjectFields<{ listings?: unknown }>(shopObject)

  return normalizeIdOrThrow(
    normalizeOptionalIdFromValue(shopFields.listings),
    `Shop ${shopId} is missing its listings table id.`
  )
}

export const findAddedItemListingId = (
  transactionResult: SuiTransactionBlockResponse
): string | undefined => {
  const addedListingEvent = (transactionResult.events ?? []).find((event) =>
    event.type.endsWith(ITEM_LISTING_ADDED_EVENT_TYPE_SUFFIX)
  )
  if (!addedListingEvent?.parsedJson) return undefined
  if (
    typeof addedListingEvent.parsedJson !== "object" ||
    Array.isArray(addedListingEvent.parsedJson)
  ) {
    return undefined
  }

  const parsedFields = addedListingEvent.parsedJson as Record<string, unknown>

  return normalizeListingIdFromValue(parsedFields.listing_id)
}

export const getItemListingSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const listingsTableId = await resolveListingsTableId(shopId, suiClient)
  const listingDynamicFields = await getAllDynamicFields(
    {
      parentObjectId: listingsTableId
    },
    { suiClient }
  )

  if (listingDynamicFields.length === 0) return []

  const listingEntries = await Promise.all(
    listingDynamicFields.map(async (dynamicField) => {
      const listingId = normalizeListingIdOrThrow(
        (dynamicField.name as { value?: unknown })?.value,
        `Missing listing id for dynamic field ${dynamicField.objectId}.`
      )
      const { object: listingFieldObject } = await getSuiObject(
        {
          objectId: dynamicField.objectId,
          options: { showContent: true, showType: true }
        },
        { suiClient }
      )

      return buildItemListingSummary(
        listingFieldObject,
        listingId,
        dynamicField.objectId
      )
    })
  )

  return listingEntries.sort((left, right) => {
    const leftId = BigInt(left.itemListingId)
    const rightId = BigInt(right.itemListingId)
    if (leftId === rightId) return 0
    return leftId < rightId ? -1 : 1
  })
}

export const getItemListingDetails = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingDetails> => {
  const listingId = normalizeListingIdOrThrow(
    itemListingId,
    "Listing id must be a non-negative u64."
  )
  const listingsTableId = await resolveListingsTableId(shopId, suiClient)
  const listingDynamicField = await getSuiDynamicFieldObjectByName(
    {
      parentObjectId: listingsTableId,
      name: {
        type: "u64",
        value: listingId
      }
    },
    { suiClient }
  )

  return buildItemListingDetails(
    listingDynamicField.object,
    listingId,
    listingDynamicField.dynamicFieldId
  )
}

export const getItemListingSummary = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary> => {
  const listingDetails = await getItemListingDetails(
    shopId,
    itemListingId,
    suiClient
  )

  if (!listingDetails.markerObjectId)
    throw new Error(
      `Listing ${itemListingId} is missing the dynamic field marker object id.`
    )

  return {
    ...listingDetails,
    markerObjectId: listingDetails.markerObjectId
  }
}

const buildItemListingSummary = (
  listingObject: SuiObjectData,
  listingId: string,
  markerObjectId: string
): ItemListingSummary => ({
  ...buildItemListingDetails(listingObject, listingId, markerObjectId),
  markerObjectId
})

const buildItemListingDetails = (
  listingObject: SuiObjectData,
  listingId: string,
  markerObjectId?: string
): ItemListingDetails => {
  const itemListingFields = unwrapMoveObjectFields<{
    listing_id?: unknown
    item_type?: unknown
    name?: unknown
    base_price_usd_cents?: unknown
    stock?: unknown
    spotlight_discount_template_id?: unknown
  }>(listingObject)
  const itemType =
    formatTypeNameFromFieldValue(itemListingFields.item_type) || "Unknown"
  const listingIdFromField = normalizeListingIdFromValue(
    itemListingFields.listing_id
  )
  if (listingIdFromField && listingIdFromField !== listingId)
    throw new Error(
      `Listing id mismatch: dynamic field key ${listingId} does not match listing payload ${listingIdFromField}.`
    )

  return {
    itemListingId: listingId,
    markerObjectId,
    name: readMoveStringOrVector(itemListingFields.name),
    itemType,
    basePriceUsdCents: formatOptionalNumericValue(
      itemListingFields.base_price_usd_cents
    ),
    stock: formatOptionalNumericValue(itemListingFields.stock),
    spotlightTemplateId: normalizeOptionalIdFromValue(
      itemListingFields.spotlight_discount_template_id
    )
  }
}
