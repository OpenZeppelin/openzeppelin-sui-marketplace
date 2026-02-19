import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  getTableEntryDynamicFields,
  resolveTableObjectIdFromField
} from "@sui-oracle-market/tooling-core/table"
import {
  formatOptionalNumericValue,
  readMoveStringOrVector
} from "@sui-oracle-market/tooling-core/utils/formatters"
import { normalizeBigIntFromMoveValue } from "@sui-oracle-market/tooling-core/utils/move-values"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { formatTypeNameFromFieldValue } from "@sui-oracle-market/tooling-core/utils/type-name"

export const ITEM_LISTING_TYPE_FRAGMENT = "::shop::ItemListing"
export const ITEM_LISTING_ADDED_EVENT_TYPE_FRAGMENT =
  "::shop::ItemListingAddedEvent"
const SHOP_LISTINGS_FIELD = "listings"

export type ItemListingDetails = {
  itemListingId: string
  tableEntryFieldId?: string
  markerObjectId?: string
  name?: string
  itemType: string
  basePriceUsdCents?: string
  stock?: string
  spotlightTemplateId?: string
}

export type ItemListingSummary = ItemListingDetails & {
  tableEntryFieldId: string
  markerObjectId: string
}

type ItemListingTableEntryField = Awaited<
  ReturnType<typeof getTableEntryDynamicFields>
>[number]

export const normalizeListingId = (
  listingId: string,
  label = "listingId"
): string => parseNonNegativeU64(listingId, label).toString()

export const normalizeOptionalListingIdFromValue = (
  value: unknown
): string | undefined => {
  const listingId = normalizeBigIntFromMoveValue(value)
  if (listingId === undefined || listingId < 0n) return undefined
  return listingId.toString()
}

export const extractListingIdFromItemListingAddedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string | undefined => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const itemListingAddedEvent = events?.find((event) => {
    if (!event.type.endsWith(ITEM_LISTING_ADDED_EVENT_TYPE_FRAGMENT))
      return false
    if (
      !event.parsedJson ||
      typeof event.parsedJson !== "object" ||
      Array.isArray(event.parsedJson)
    )
      return false

    const eventFields = event.parsedJson as Record<string, unknown>
    return (
      normalizeOptionalIdFromValue(eventFields.shop_id) === normalizedShopId
    )
  })

  if (
    !itemListingAddedEvent?.parsedJson ||
    typeof itemListingAddedEvent.parsedJson !== "object" ||
    Array.isArray(itemListingAddedEvent.parsedJson)
  )
    return undefined

  const eventFields = itemListingAddedEvent.parsedJson as Record<
    string,
    unknown
  >
  return normalizeOptionalListingIdFromValue(eventFields.listing_id)
}

export const requireListingIdFromItemListingAddedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string => {
  const listingId = extractListingIdFromItemListingAddedEvents({
    events,
    shopId
  })
  if (!listingId)
    throw new Error(
      "Expected an ItemListingAddedEvent for this shop, but it was not found."
    )

  return listingId
}

const getListingsTableObjectId = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}): Promise<string> => {
  const { object: shopObject } = await getSuiObject(
    { objectId: shopId, options: { showContent: true, showType: true } },
    { suiClient }
  )

  return resolveTableObjectIdFromField({
    object: shopObject,
    fieldName: SHOP_LISTINGS_FIELD
  })
}

const getItemListingTableEntryFields = async ({
  tableObjectId,
  suiClient
}: {
  tableObjectId: string
  suiClient: SuiClient
}): Promise<ItemListingTableEntryField[]> =>
  getTableEntryDynamicFields(
    {
      tableObjectId,
      objectTypeFilter: ITEM_LISTING_TYPE_FRAGMENT
    },
    { suiClient }
  )

const getListingIdFromTableEntryField = (
  tableEntryField: ItemListingTableEntryField
): string => {
  const listingId = normalizeOptionalListingIdFromValue(
    tableEntryField.name.value
  )
  if (!listingId)
    throw new Error(
      `Missing listing id for listing table entry ${tableEntryField.objectId}.`
    )

  return listingId
}

const findItemListingTableEntryFieldByListingId = ({
  listingId,
  tableEntryFields
}: {
  listingId: string
  tableEntryFields: ItemListingTableEntryField[]
}): ItemListingTableEntryField | undefined =>
  tableEntryFields.find(
    (tableEntryField) =>
      getListingIdFromTableEntryField(tableEntryField) === listingId
  )

export const getItemListingSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const listingsTableObjectId = await getListingsTableObjectId({
    shopId,
    suiClient
  })
  const tableEntryFields = await getItemListingTableEntryFields({
    tableObjectId: listingsTableObjectId,
    suiClient
  })
  if (tableEntryFields.length === 0) return []

  const itemListingTableEntryObjects = await Promise.all(
    tableEntryFields.map((tableEntryField) =>
      getSuiObject(
        {
          objectId: tableEntryField.objectId,
          options: { showContent: true, showType: true }
        },
        { suiClient }
      )
    )
  )

  return itemListingTableEntryObjects.map((response, index) =>
    buildItemListingSummary(
      response.object,
      getListingIdFromTableEntryField(tableEntryFields[index]),
      tableEntryFields[index].objectId
    )
  )
}

export const getItemListingDetails = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingDetails> => {
  const normalizedListingId = normalizeListingId(itemListingId)
  const listingsTableObjectId = await getListingsTableObjectId({
    shopId,
    suiClient
  })
  const tableEntryFields = await getItemListingTableEntryFields({
    tableObjectId: listingsTableObjectId,
    suiClient
  })
  const tableEntryField = findItemListingTableEntryFieldByListingId({
    listingId: normalizedListingId,
    tableEntryFields
  })
  if (!tableEntryField)
    throw new Error(
      `No listing ${normalizedListingId} found in shop ${shopId}.`
    )

  const { object } = await getSuiObject(
    {
      objectId: tableEntryField.objectId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )
  return buildItemListingDetails(
    object,
    normalizedListingId,
    tableEntryField.objectId
  )
}

export const getItemListingSummary = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary> => {
  const normalizedListingId = normalizeListingId(itemListingId)
  const listingsTableObjectId = await getListingsTableObjectId({
    shopId,
    suiClient
  })
  const tableEntryFields = await getItemListingTableEntryFields({
    tableObjectId: listingsTableObjectId,
    suiClient
  })
  const tableEntryField = findItemListingTableEntryFieldByListingId({
    listingId: normalizedListingId,
    tableEntryFields
  })
  if (!tableEntryField)
    throw new Error(
      `No listing ${normalizedListingId} found in shop ${shopId}.`
    )

  const { object } = await getSuiObject(
    {
      objectId: tableEntryField.objectId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return buildItemListingSummary(
    object,
    normalizedListingId,
    tableEntryField.objectId
  )
}

const buildItemListingSummary = (
  listingObject: SuiObjectData,
  listingId: string,
  tableEntryFieldId: string
): ItemListingSummary => ({
  ...buildItemListingDetails(listingObject, listingId, tableEntryFieldId),
  tableEntryFieldId,
  markerObjectId: tableEntryFieldId
})

const buildItemListingDetails = (
  listingObject: SuiObjectData,
  listingId: string,
  tableEntryFieldId?: string
): ItemListingDetails => {
  const itemListingFields = unwrapMoveObjectFields(listingObject)
  const itemType =
    formatTypeNameFromFieldValue(itemListingFields.item_type) || "Unknown"

  return {
    itemListingId: listingId,
    tableEntryFieldId,
    markerObjectId: tableEntryFieldId,
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
