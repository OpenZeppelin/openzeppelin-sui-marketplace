import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  TABLE_KEY_TYPE_U64,
  getTableEntryDynamicFieldObject,
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
  name?: string
  itemType: string
  basePriceUsdCents?: string
  stock?: string
  spotlightTemplateId?: string
}

export type ItemListingSummary = ItemListingDetails & {
  tableEntryFieldId: string
}

type ItemListingTableEntryField = Awaited<
  ReturnType<typeof getTableEntryDynamicFields>
>[number]

type OrderedItemListingTableEntry = {
  tableEntryField: ItemListingTableEntryField
  listingId: string
}

export const normalizeListingId = (
  listingId: string,
  label = "listingId"
): string => parseNonNegativeU64(listingId, label).toString()

export const normalizeListingIdAsBigIntU64 = (
  listingId: string,
  label = "listingId"
): bigint => BigInt(normalizeListingId(listingId, label))

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

const compareListingIdStrings = (
  leftListingId: string,
  rightListingId: string
) => {
  const left = BigInt(leftListingId)
  const right = BigInt(rightListingId)
  if (left === right) return 0
  return left < right ? -1 : 1
}

const sortListingTableEntriesByListingId = (
  tableEntryFields: ItemListingTableEntryField[]
): OrderedItemListingTableEntry[] =>
  tableEntryFields
    .map((tableEntryField) => ({
      tableEntryField,
      listingId: getListingIdFromTableEntryField(tableEntryField)
    }))
    .sort((leftEntry, rightEntry) =>
      compareListingIdStrings(leftEntry.listingId, rightEntry.listingId)
    )

const requireItemListingTableEntryObject = async ({
  shopId,
  listingId,
  suiClient
}: {
  shopId: string
  listingId: string
  suiClient: SuiClient
}): Promise<SuiObjectData> => {
  const listingsTableObjectId = await getListingsTableObjectId({
    shopId,
    suiClient
  })

  const tableEntryObject = await getTableEntryDynamicFieldObject(
    {
      tableObjectId: listingsTableObjectId,
      keyType: TABLE_KEY_TYPE_U64,
      keyValue: listingId
    },
    { suiClient }
  )
  if (!tableEntryObject)
    throw new Error(`No listing ${listingId} found in shop ${shopId}.`)

  return tableEntryObject
}

const getItemListingObjectByTableEntryField = async ({
  tableEntryField,
  suiClient
}: {
  tableEntryField: ItemListingTableEntryField
  suiClient: SuiClient
}): Promise<SuiObjectData> =>
  (
    await getSuiObject(
      {
        objectId: tableEntryField.objectId,
        options: { showContent: true, showType: true }
      },
      { suiClient }
    )
  ).object

const getItemListingSummaryFromOrderedTableEntry = async ({
  orderedTableEntry,
  suiClient
}: {
  orderedTableEntry: OrderedItemListingTableEntry
  suiClient: SuiClient
}): Promise<ItemListingSummary> => {
  const tableEntryObject = await getItemListingObjectByTableEntryField({
    tableEntryField: orderedTableEntry.tableEntryField,
    suiClient
  })

  return buildItemListingSummary(
    tableEntryObject,
    orderedTableEntry.listingId,
    orderedTableEntry.tableEntryField.objectId
  )
}

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
  const orderedTableEntries =
    sortListingTableEntriesByListingId(tableEntryFields)

  return Promise.all(
    orderedTableEntries.map((orderedTableEntry) =>
      getItemListingSummaryFromOrderedTableEntry({
        orderedTableEntry,
        suiClient
      })
    )
  )
}

export const getItemListingDetails = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingDetails> => {
  const normalizedListingId = normalizeListingId(itemListingId)
  const tableEntryObject = await requireItemListingTableEntryObject({
    shopId,
    listingId: normalizedListingId,
    suiClient
  })
  return buildItemListingDetails(
    tableEntryObject,
    normalizedListingId,
    tableEntryObject.objectId
  )
}

export const getItemListingSummary = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary> => {
  const normalizedListingId = normalizeListingId(itemListingId)
  const tableEntryObject = await requireItemListingTableEntryObject({
    shopId,
    listingId: normalizedListingId,
    suiClient
  })

  return buildItemListingSummary(
    tableEntryObject,
    normalizedListingId,
    tableEntryObject.objectId
  )
}

const buildItemListingSummary = (
  listingObject: SuiObjectData,
  listingId: string,
  tableEntryFieldId: string
): ItemListingSummary => ({
  ...buildItemListingDetails(listingObject, listingId, tableEntryFieldId),
  tableEntryFieldId
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
