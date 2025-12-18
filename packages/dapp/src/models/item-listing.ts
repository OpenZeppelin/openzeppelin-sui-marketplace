import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import {
  fetchAllDynamicFields,
  getSuiDynamicFieldObject
} from "../tooling/dynamic-fields.ts"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../tooling/object.ts"
import {
  decodeUtf8Vector,
  formatOptionalNumericValue
} from "../utils/formatters.ts"
import { formatTypeNameFromFieldValue } from "../utils/type-name.ts"

export const ITEM_LISTING_MARKER_TYPE_FRAGMENT = "::shop::ItemListingMarker"

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

export const fetchItemListingSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const itemListingFields = await fetchAllDynamicFields(
    {
      parentObjectId: shopId,
      objectTypeFilter: ITEM_LISTING_MARKER_TYPE_FRAGMENT
    },
    suiClient
  )

  if (itemListingFields.length === 0) return []

  const listingIds = itemListingFields.map((field) =>
    normalizeIdOrThrow(
      normalizeOptionalIdFromValue((field.name as { value?: string })?.value),
      `Missing listing id for marker ${field.objectId}.`
    )
  )

  const itemListingObjects = await Promise.all(
    listingIds.map((listingId) =>
      getSuiObject(
        {
          objectId: listingId,
          options: { showContent: true, showType: true }
        },
        suiClient
      )
    )
  )

  return itemListingObjects.map((response, index) =>
    buildItemListingSummary(
      response.object,
      listingIds[index],
      itemListingFields[index].objectId
    )
  )
}

export const getItemListingDetails = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingDetails> => {
  const { object } = await getSuiObject(
    {
      objectId: itemListingId,
      options: { showContent: true, showType: true }
    },
    suiClient
  )

  let markerObjectId: string | undefined

  try {
    const marker = await getSuiDynamicFieldObject(
      { parentObjectId: shopId, childObjectId: itemListingId },
      suiClient
    )
    markerObjectId = marker.dynamicFieldId
  } catch {
    markerObjectId = undefined
  }

  return buildItemListingDetails(object, itemListingId, markerObjectId)
}

export const getItemListingSummary = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary> => {
  const { object } = await getSuiObject(
    {
      objectId: itemListingId,
      options: { showContent: true, showType: true }
    },
    suiClient
  )
  const marker = await getSuiDynamicFieldObject(
    { parentObjectId: shopId, childObjectId: itemListingId },
    suiClient
  )

  return buildItemListingSummary(object, itemListingId, marker.dynamicFieldId)
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
  const itemListingFields = unwrapMoveObjectFields(listingObject)
  const itemType =
    formatTypeNameFromFieldValue(itemListingFields.item_type) || "Unknown"

  return {
    itemListingId: listingId,
    markerObjectId,
    name: decodeUtf8Vector(itemListingFields.name),
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
