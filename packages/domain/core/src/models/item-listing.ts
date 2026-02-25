import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  getTableEntryDynamicFieldObject,
  getTableEntryDynamicFields,
  resolveTableObjectIdFromField
} from "@sui-oracle-market/tooling-core/table"
import {
  formatOptionalNumericValue,
  readMoveStringOrVector
} from "@sui-oracle-market/tooling-core/utils/formatters"
import { normalizeBigIntFromMoveValue } from "@sui-oracle-market/tooling-core/utils/move-values"
import { formatTypeNameFromFieldValue } from "@sui-oracle-market/tooling-core/utils/type-name"

export const ITEM_LISTING_TYPE_FRAGMENT = "::shop::ItemListing"
export const ITEM_LISTING_ADDED_EVENT_TYPE_FRAGMENT =
  "::shop::ItemListingAddedEvent"
const SHOP_LISTINGS_FIELD = "listings"
const SHOP_LISTING_INDICES_FIELD = "listing_indices"
const TABLE_KEY_TYPE_ID = "0x2::object::ID"
const TABLE_KEY_TYPE_U64 = "u64"

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
type ItemListingFields = Record<string, unknown>
type ItemListingTableEntryObject = {
  tableEntryFieldId: string
  tableIndex: bigint
  object: SuiObjectData
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const looksLikeItemListingFields = (
  value: unknown
): value is ItemListingFields =>
  isRecord(value) && "item_type" in value && "listing_id" in value

const unwrapFields = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined

  if ("fields" in value && isRecord(value.fields))
    return value.fields as Record<string, unknown>

  return value
}

const extractOptionalItemListingFields = (
  value: unknown
): ItemListingFields | undefined => {
  if (looksLikeItemListingFields(value)) return value

  if (Array.isArray(value)) {
    for (const entry of value) {
      const itemListingFields = extractOptionalItemListingFields(entry)
      if (itemListingFields) return itemListingFields
    }

    return undefined
  }

  const fields = unwrapFields(value)
  if (!fields) return undefined
  if (looksLikeItemListingFields(fields)) return fields

  const noneField = (fields as { none?: unknown }).none
  if (noneField !== undefined) return undefined

  const someField = (fields as { some?: unknown }).some
  if (someField !== undefined)
    return extractOptionalItemListingFields(someField)

  const vectorField = (fields as { vec?: unknown }).vec
  if (Array.isArray(vectorField))
    return extractOptionalItemListingFields(vectorField)

  const valueField = (fields as { value?: unknown }).value
  if (valueField !== undefined)
    return extractOptionalItemListingFields(valueField)

  const nestedValues = Object.values(fields)
  if (nestedValues.length === 1)
    return extractOptionalItemListingFields(nestedValues[0])

  return undefined
}

const getOptionalItemListingFieldsFromTableEntryObject = (
  tableEntryObject: SuiObjectData
): ItemListingFields | undefined =>
  extractOptionalItemListingFields(unwrapMoveObjectFields(tableEntryObject))

const getItemListingFieldsFromTableEntryObject = (
  tableEntryObject: SuiObjectData
): ItemListingFields => {
  const itemListingFields =
    getOptionalItemListingFieldsFromTableEntryObject(tableEntryObject)
  if (itemListingFields) return itemListingFields

  throw new Error(
    `Listing table entry ${tableEntryObject.objectId} does not contain an active ItemListing value.`
  )
}

const getListingIdFromItemListingFields = (
  itemListingFields: ItemListingFields,
  tableEntryFieldId: string
): string => {
  const listingId = normalizeOptionalListingIdFromValue(
    itemListingFields.listing_id
  )
  if (listingId) return listingId

  throw new Error(
    `Missing listing id for listing table entry ${tableEntryFieldId}.`
  )
}

const getOptionalListingIdFromTableEntryObject = ({
  tableEntryFieldId,
  tableEntryObject
}: {
  tableEntryFieldId: string
  tableEntryObject: SuiObjectData
}): string | undefined => {
  const itemListingFields =
    getOptionalItemListingFieldsFromTableEntryObject(tableEntryObject)
  if (!itemListingFields) return undefined

  return getListingIdFromItemListingFields(itemListingFields, tableEntryFieldId)
}

const getOptionalListingIdFromTableEntry = (
  tableEntryObject: ItemListingTableEntryObject
): string | undefined =>
  getOptionalListingIdFromTableEntryObject({
    tableEntryFieldId: tableEntryObject.tableEntryFieldId,
    tableEntryObject: tableEntryObject.object
  })

const getTableIndexFromTableEntryField = (
  tableEntryField: ItemListingTableEntryField
): bigint => {
  const tableIndex = normalizeBigIntFromMoveValue(tableEntryField.name.value)
  if (tableIndex !== undefined && tableIndex >= 0n) return tableIndex

  throw new Error(
    `Missing table index for listing table entry ${tableEntryField.objectId}.`
  )
}

const compareTableEntryObjectsByTableIndex = (
  left: ItemListingTableEntryObject,
  right: ItemListingTableEntryObject
): number => {
  if (left.tableIndex < right.tableIndex) return -1
  if (left.tableIndex > right.tableIndex) return 1
  return left.tableEntryFieldId.localeCompare(right.tableEntryFieldId)
}

const hasHexPrefix = (value: string): boolean =>
  value.trim().toLowerCase().startsWith("0x")

export const normalizeListingId = (
  listingId: string,
  label = "listingId"
): string => {
  if (!hasHexPrefix(listingId))
    throw new Error(`${label} must be a valid Sui object ID.`)

  try {
    return normalizeSuiObjectId(listingId.trim())
  } catch {
    throw new Error(`${label} must be a valid Sui object ID.`)
  }
}

export const normalizeOptionalListingIdFromValue = (
  value: unknown
): string | undefined => {
  if (typeof value === "string" && !hasHexPrefix(value)) return undefined
  return normalizeOptionalIdFromValue(value)
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

type ItemListingStorageObjectIds = {
  listingsTableObjectId: string
  listingIndicesTableObjectId: string
}

const getItemListingStorageObjectIds = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}): Promise<ItemListingStorageObjectIds> => {
  const { object: shopObject } = await getSuiObject(
    { objectId: shopId, options: { showContent: true, showType: true } },
    { suiClient }
  )

  return {
    listingsTableObjectId: resolveTableObjectIdFromField({
      object: shopObject,
      fieldName: SHOP_LISTINGS_FIELD
    }),
    listingIndicesTableObjectId: resolveTableObjectIdFromField({
      object: shopObject,
      fieldName: SHOP_LISTING_INDICES_FIELD
    })
  }
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

const getItemListingTableEntryObjects = async ({
  tableObjectId,
  suiClient
}: {
  tableObjectId: string
  suiClient: SuiClient
}): Promise<ItemListingTableEntryObject[]> => {
  const tableEntryFields = await getItemListingTableEntryFields({
    tableObjectId,
    suiClient
  })
  if (tableEntryFields.length === 0) return []

  const tableEntryObjects = await Promise.all(
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

  const entries = tableEntryObjects.map((response, index) => ({
    tableEntryFieldId: tableEntryFields[index].objectId,
    tableIndex: getTableIndexFromTableEntryField(tableEntryFields[index]),
    object: response.object
  }))

  return entries.sort(compareTableEntryObjectsByTableIndex)
}

const getListingIndexFromListingIndicesEntryObject = ({
  listingId,
  listingIndicesEntryObject
}: {
  listingId: string
  listingIndicesEntryObject: SuiObjectData
}): bigint => {
  const listingIndicesEntryFields = unwrapMoveObjectFields<
    Record<string, unknown>
  >(listingIndicesEntryObject)
  const listingIndex = normalizeBigIntFromMoveValue(
    listingIndicesEntryFields.value
  )
  if (listingIndex !== undefined && listingIndex >= 0n) return listingIndex

  throw new Error(
    `Listing index entry for ${listingId} does not contain a valid index value.`
  )
}

const getItemListingTableEntryByIndex = async ({
  listingsTableObjectId,
  listingIndex,
  suiClient
}: {
  listingsTableObjectId: string
  listingIndex: bigint
  suiClient: SuiClient
}): Promise<ItemListingTableEntryObject | undefined> => {
  const tableEntryObject = await getTableEntryDynamicFieldObject(
    {
      tableObjectId: listingsTableObjectId,
      keyType: TABLE_KEY_TYPE_U64,
      keyValue: listingIndex.toString()
    },
    { suiClient }
  )
  if (!tableEntryObject) return undefined

  return {
    tableEntryFieldId: tableEntryObject.objectId,
    tableIndex: listingIndex,
    object: tableEntryObject
  }
}

const getItemListingTableEntryById = async ({
  shopId,
  itemListingId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  suiClient: SuiClient
}): Promise<{
  normalizedListingId: string
  tableEntryObject: ItemListingTableEntryObject
}> => {
  const normalizedListingId = normalizeListingId(itemListingId)
  const { listingsTableObjectId, listingIndicesTableObjectId } =
    await getItemListingStorageObjectIds({
      shopId,
      suiClient
    })
  const listingIndicesEntryObject = await getTableEntryDynamicFieldObject(
    {
      tableObjectId: listingIndicesTableObjectId,
      keyType: TABLE_KEY_TYPE_ID,
      keyValue: normalizedListingId
    },
    { suiClient }
  )
  if (!listingIndicesEntryObject)
    throw new Error(
      `No listing ${normalizedListingId} found in shop ${shopId}.`
    )

  const listingIndex = getListingIndexFromListingIndicesEntryObject({
    listingId: normalizedListingId,
    listingIndicesEntryObject
  })
  const tableEntryObject = await getItemListingTableEntryByIndex({
    listingsTableObjectId,
    listingIndex,
    suiClient
  })
  if (!tableEntryObject)
    throw new Error(
      `No listing ${normalizedListingId} found in shop ${shopId}.`
    )
  if (
    getOptionalListingIdFromTableEntry(tableEntryObject) !== normalizedListingId
  )
    throw new Error(
      `No listing ${normalizedListingId} found in shop ${shopId}.`
    )

  return { normalizedListingId, tableEntryObject }
}

const getItemListingTableEntries = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}): Promise<ItemListingTableEntryObject[]> => {
  const { listingsTableObjectId } = await getItemListingStorageObjectIds({
    shopId,
    suiClient
  })
  return getItemListingTableEntryObjects({
    tableObjectId: listingsTableObjectId,
    suiClient
  })
}

export const getItemListingSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const tableEntryObjects = await getItemListingTableEntries({
    shopId,
    suiClient
  })
  if (tableEntryObjects.length === 0) return []

  return tableEntryObjects.flatMap((tableEntryObject) => {
    const listingId = getOptionalListingIdFromTableEntry(tableEntryObject)
    if (!listingId) return []

    return [
      buildItemListingSummary(
        tableEntryObject.object,
        listingId,
        tableEntryObject.tableEntryFieldId
      )
    ]
  })
}

export const getItemListingDetails = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingDetails> => {
  const { normalizedListingId, tableEntryObject } =
    await getItemListingTableEntryById({
      shopId,
      itemListingId,
      suiClient
    })

  return buildItemListingDetails(
    tableEntryObject.object,
    normalizedListingId,
    tableEntryObject.tableEntryFieldId
  )
}

export const getItemListingSummary = async (
  shopId: string,
  itemListingId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary> => {
  const { normalizedListingId, tableEntryObject } =
    await getItemListingTableEntryById({
      shopId,
      itemListingId,
      suiClient
    })

  return buildItemListingSummary(
    tableEntryObject.object,
    normalizedListingId,
    tableEntryObject.tableEntryFieldId
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
  const itemListingFields =
    getItemListingFieldsFromTableEntryObject(listingObject)
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
