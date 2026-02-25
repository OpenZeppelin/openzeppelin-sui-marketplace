import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type * as ToolingObjectModule from "@sui-oracle-market/tooling-core/object"
import type * as ToolingTableModule from "@sui-oracle-market/tooling-core/table"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getSuiObjectMock,
  getTableEntryDynamicFieldObjectMock,
  getTableEntryDynamicFieldsMock,
  resolveTableObjectIdFromFieldMock
} = vi.hoisted(() => ({
  getSuiObjectMock: vi.fn(),
  getTableEntryDynamicFieldObjectMock: vi.fn(),
  getTableEntryDynamicFieldsMock: vi.fn(),
  resolveTableObjectIdFromFieldMock: vi.fn()
}))

vi.mock("@sui-oracle-market/tooling-core/object", async () => {
  const actual = await vi.importActual<typeof ToolingObjectModule>(
    "@sui-oracle-market/tooling-core/object"
  )

  return {
    ...actual,
    getSuiObject: getSuiObjectMock
  }
})

vi.mock("@sui-oracle-market/tooling-core/table", async () => {
  const actual = await vi.importActual<typeof ToolingTableModule>(
    "@sui-oracle-market/tooling-core/table"
  )

  return {
    ...actual,
    getTableEntryDynamicFieldObject: getTableEntryDynamicFieldObjectMock,
    getTableEntryDynamicFields: getTableEntryDynamicFieldsMock,
    resolveTableObjectIdFromField: resolveTableObjectIdFromFieldMock
  }
})

import {
  getItemListingSummaries,
  getItemListingSummary,
  normalizeListingId,
  normalizeOptionalListingIdFromValue
} from "@sui-oracle-market/domain-core/models/item-listing"

type TableEntryObject = {
  objectId: string
  object: SuiObjectData
  tableNameValue: string
  listingId?: string
}

const buildMoveObject = ({
  objectId,
  fields
}: {
  objectId: string
  fields: Record<string, unknown>
}): SuiObjectData => {
  const normalizedObjectId = normalizeSuiObjectId(objectId)

  return {
    objectId: normalizedObjectId,
    digest: "mock-digest",
    version: "1",
    type: "0x2::dynamic_field::Field<u64,0x1::option::Option<0x2::shop::ItemListing>>",
    content: {
      dataType: "moveObject",
      hasPublicTransfer: false,
      type: "0x2::dynamic_field::Field<u64,0x1::option::Option<0x2::shop::ItemListing>>",
      fields
    }
  } as unknown as SuiObjectData
}

const buildShopObject = (shopId: string): SuiObjectData =>
  buildMoveObject({
    objectId: shopId,
    fields: {
      listings: {
        fields: {
          contents: {
            id: { id: normalizeSuiObjectId("0x777") }
          }
        }
      }
    }
  })

const buildActiveListingEntryObject = ({
  objectId,
  listingId,
  shopId,
  name,
  tableNameValue
}: {
  objectId: string
  listingId: string
  shopId: string
  name: string
  tableNameValue: string
}): TableEntryObject => {
  const normalizedListingId = normalizeSuiObjectId(listingId)
  const normalizedShopId = normalizeSuiObjectId(shopId)

  return {
    objectId: normalizeSuiObjectId(objectId),
    listingId: normalizedListingId,
    tableNameValue,
    object: buildMoveObject({
      objectId,
      fields: {
        value: {
          fields: {
            some: {
              fields: {
                listing_id: { id: normalizedListingId },
                shop_id: { id: normalizedShopId },
                item_type: "0x2::items::Car",
                name,
                base_price_usd_cents: "1250",
                stock: "3",
                spotlight_discount_template_id: { none: true },
                active_bound_template_count: "0"
              }
            }
          }
        }
      }
    })
  }
}

const buildTombstonedListingEntryObject = ({
  objectId,
  tableNameValue
}: {
  objectId: string
  tableNameValue: string
}): TableEntryObject => ({
  objectId: normalizeSuiObjectId(objectId),
  tableNameValue,
  object: buildMoveObject({
    objectId,
    fields: {
      value: {
        fields: {
          none: true
        }
      }
    }
  })
})

const configureListingTableMocks = ({
  shopId,
  tableEntries
}: {
  shopId: string
  tableEntries: TableEntryObject[]
}) => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const listingsTableObjectId = normalizeSuiObjectId("0x777")
  const listingIndicesTableObjectId = normalizeSuiObjectId("0x778")

  resolveTableObjectIdFromFieldMock.mockImplementation(
    ({ fieldName }: { fieldName: string }) =>
      fieldName === "listing_indices"
        ? listingIndicesTableObjectId
        : listingsTableObjectId
  )
  getTableEntryDynamicFieldsMock.mockResolvedValue(
    tableEntries.map((tableEntry) => ({
      objectId: tableEntry.objectId,
      objectType:
        "0x2::dynamic_field::Field<u64,0x1::option::Option<0x2::shop::ItemListing>>",
      name: {
        type: "u64",
        value: tableEntry.tableNameValue
      }
    }))
  )

  const objectsById = new Map<string, SuiObjectData>()
  objectsById.set(normalizedShopId, buildShopObject(normalizedShopId))
  for (const tableEntry of tableEntries) {
    objectsById.set(tableEntry.objectId, tableEntry.object)
  }

  const listingIndexByListingId = new Map<string, string>()
  const tableEntryByIndex = new Map<string, TableEntryObject>()
  for (const tableEntry of tableEntries) {
    tableEntryByIndex.set(tableEntry.tableNameValue, tableEntry)
    if (tableEntry.listingId)
      listingIndexByListingId.set(
        tableEntry.listingId,
        tableEntry.tableNameValue
      )
  }

  getTableEntryDynamicFieldObjectMock.mockImplementation(
    async ({
      tableObjectId,
      keyType,
      keyValue
    }: {
      tableObjectId: string
      keyType: string
      keyValue: unknown
    }) => {
      const normalizedTableObjectId = normalizeSuiObjectId(tableObjectId)
      if (
        normalizedTableObjectId === listingIndicesTableObjectId &&
        keyType === "0x2::object::ID" &&
        typeof keyValue === "string"
      ) {
        const normalizedListingId = normalizeSuiObjectId(keyValue)
        const listingIndex = listingIndexByListingId.get(normalizedListingId)
        if (!listingIndex) return undefined

        return buildMoveObject({
          objectId: `0x99${listingIndex}`,
          fields: {
            name: { id: normalizedListingId },
            value: listingIndex
          }
        })
      }

      if (
        normalizedTableObjectId === listingsTableObjectId &&
        keyType === "u64"
      ) {
        const listingIndex = String(keyValue)
        return tableEntryByIndex.get(listingIndex)?.object
      }

      return undefined
    }
  )

  getSuiObjectMock.mockImplementation(
    async ({ objectId }: { objectId: string }) => {
      const normalizedObjectId = normalizeSuiObjectId(objectId)
      const object = objectsById.get(normalizedObjectId)
      if (!object)
        throw new Error(`Mock object ${normalizedObjectId} not configured.`)

      return { object }
    }
  )
}

describe("item listing model", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns only active listings from tablevec entries and skips tombstones", async () => {
    const shopId = normalizeSuiObjectId("0x55")
    const activeEntry = buildActiveListingEntryObject({
      objectId: "0xa1",
      listingId: "0xb1",
      shopId,
      name: "City Car",
      tableNameValue: "42"
    })
    const tombstonedEntry = buildTombstonedListingEntryObject({
      objectId: "0xa2",
      tableNameValue: "43"
    })

    configureListingTableMocks({
      shopId,
      tableEntries: [activeEntry, tombstonedEntry]
    })

    const listingSummaries = await getItemListingSummaries(
      shopId,
      {} as SuiClient
    )

    expect(listingSummaries).toHaveLength(1)
    expect(listingSummaries[0]).toMatchObject({
      itemListingId: normalizeSuiObjectId("0xb1"),
      tableEntryFieldId: activeEntry.objectId,
      name: "City Car",
      basePriceUsdCents: "1250",
      stock: "3",
      spotlightTemplateId: undefined
    })
    expect(listingSummaries[0].itemType.endsWith("::items::Car")).toBe(true)
  })

  it("returns listing summaries in deterministic table index order", async () => {
    const shopId = normalizeSuiObjectId("0x54")
    const lateEntry = buildActiveListingEntryObject({
      objectId: "0xaa",
      listingId: "0xba",
      shopId,
      name: "Second Listing",
      tableNameValue: "2"
    })
    const earlyEntry = buildActiveListingEntryObject({
      objectId: "0xab",
      listingId: "0xbb",
      shopId,
      name: "First Listing",
      tableNameValue: "1"
    })

    configureListingTableMocks({
      shopId,
      tableEntries: [lateEntry, earlyEntry]
    })

    const listingSummaries = await getItemListingSummaries(
      shopId,
      {} as SuiClient
    )

    expect(listingSummaries.map((summary) => summary.itemListingId)).toEqual([
      normalizeSuiObjectId("0xbb"),
      normalizeSuiObjectId("0xba")
    ])
  })

  it("resolves a listing by value.listing_id instead of the table key", async () => {
    const shopId = normalizeSuiObjectId("0x56")
    const targetListingId = normalizeSuiObjectId("0xc1")
    const activeEntry = buildActiveListingEntryObject({
      objectId: "0xa3",
      listingId: targetListingId,
      shopId,
      name: "Road Bike",
      tableNameValue: "999"
    })

    configureListingTableMocks({
      shopId,
      tableEntries: [activeEntry]
    })

    const listingSummary = await getItemListingSummary(
      shopId,
      targetListingId,
      {} as SuiClient
    )

    expect(listingSummary.itemListingId).toBe(targetListingId)
    expect(listingSummary.tableEntryFieldId).toBe(activeEntry.objectId)
    expect(listingSummary.name).toBe("Road Bike")
    expect(getTableEntryDynamicFieldsMock).not.toHaveBeenCalled()
  })

  it("throws when the listing id is not present in active tablevec entries", async () => {
    const shopId = normalizeSuiObjectId("0x57")
    const activeEntry = buildActiveListingEntryObject({
      objectId: "0xa4",
      listingId: "0xd1",
      shopId,
      name: "Scooter",
      tableNameValue: "1"
    })

    configureListingTableMocks({
      shopId,
      tableEntries: [activeEntry]
    })

    const missingListingId = normalizeSuiObjectId("0xd2")
    await expect(
      getItemListingSummary(shopId, missingListingId, {} as SuiClient)
    ).rejects.toThrow(`No listing ${missingListingId} found in shop ${shopId}.`)
  })

  it("normalizes listing ids as Sui object ids", () => {
    expect(normalizeListingId("0x2")).toBe(normalizeSuiObjectId("0x2"))
    expect(() => normalizeListingId("123", "Listing id")).toThrow(
      "Listing id must be a valid Sui object ID."
    )
  })

  it("normalizes optional listing ids from Move value shapes", () => {
    expect(normalizeOptionalListingIdFromValue({ id: "0x4" })).toBe(
      normalizeSuiObjectId("0x4")
    )
    expect(normalizeOptionalListingIdFromValue({ some: { id: "0x5" } })).toBe(
      normalizeSuiObjectId("0x5")
    )
    expect(normalizeOptionalListingIdFromValue("12")).toBeUndefined()
  })
})
