import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import {
  getAllDynamicFields,
  getSuiDynamicFieldObject
} from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  decodeUtf8Vector,
  formatOptionalNumericValue
} from "@sui-oracle-market/tooling-core/utils/formatters"
import { formatTypeNameFromFieldValue } from "@sui-oracle-market/tooling-core/utils/type-name"

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

export const getItemListingSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const itemListingFields = await getAllDynamicFields(
    {
      parentObjectId: shopId,
      objectTypeFilter: ITEM_LISTING_MARKER_TYPE_FRAGMENT
    },
    { suiClient }
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
        { suiClient }
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
    { suiClient }
  )

  let markerObjectId: string | undefined

  try {
    const marker = await getSuiDynamicFieldObject(
      { parentObjectId: shopId, childObjectId: itemListingId },
      { suiClient }
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
    { suiClient }
  )
  const marker = await getSuiDynamicFieldObject(
    { parentObjectId: shopId, childObjectId: itemListingId },
    { suiClient }
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
