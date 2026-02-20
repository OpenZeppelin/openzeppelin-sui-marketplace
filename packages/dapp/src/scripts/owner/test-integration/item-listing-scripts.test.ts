import { describe, expect, it } from "vitest"

import {
  attachDiscountTemplateToListing,
  createDappIntegrationTestEnv,
  createDiscountTemplateFixture,
  createItemListingFixture,
  createShopWithItemExamplesFixture,
  resolveItemType,
  runBuyerScriptJson,
  runOwnerScriptJson
} from "./helpers.ts"

type TransactionSummary = {
  status?: string
}

type ItemListingSummary = {
  itemListingId?: string
  tableEntryFieldId?: string
  name?: string
  itemType?: string
  basePriceUsdCents?: string
  stock?: string
  spotlightTemplateId?: string
}

type ItemListingOutput = {
  itemListing?: ItemListingSummary
  transactionSummary?: TransactionSummary
}

type RemoveItemListingOutput = {
  deleted?: string
  transactionSummary?: TransactionSummary
}

type AttachDiscountTemplateOutput = ItemListingOutput & {
  discountTemplate?: {
    discountTemplateId?: string
  }
}

type ItemListingListOutput = {
  itemListings?: Array<{
    itemListingId?: string
  }>
}

const testEnv = createDappIntegrationTestEnv()
const DEFAULT_LISTING_INPUT = {
  name: "Roadster",
  priceUsd: "12.50",
  priceUsdCents: "1250",
  stock: "4"
}

const resolveExampleItemType = (itemExamplesPackageId: string) =>
  resolveItemType(itemExamplesPackageId, "Car")

const createShopWithItemType = async (
  context: Parameters<typeof createShopWithItemExamplesFixture>[0],
  shopName: string
) => {
  const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
    await createShopWithItemExamplesFixture(context, { shopName })

  return {
    publisher,
    scriptRunner,
    shopId,
    itemType: resolveExampleItemType(itemExamplesPackageId)
  }
}

const expectSuccessfulTransaction = (summary?: TransactionSummary) => {
  expect(summary?.status).toBe("success")
}

const expectItemListingSummary = (
  listing: ItemListingSummary | undefined,
  expectations: {
    name: string
    itemType: string
    basePriceUsdCents: string
    stock: string
  }
  ) => {
  expect(listing?.itemListingId).toBeTruthy()
  expect(listing?.tableEntryFieldId).toBeTruthy()
  expect(listing?.name).toBe(expectations.name)
  expect(listing?.itemType).toBe(expectations.itemType)
  expect(listing?.basePriceUsdCents).toBe(expectations.basePriceUsdCents)
  expect(listing?.stock).toBe(expectations.stock)
}

const listItemListingIds = async ({
  scriptRunner,
  account,
  shopId
}: {
  scriptRunner: Parameters<typeof runBuyerScriptJson>[0]
  account: Parameters<typeof runBuyerScriptJson>[2]["account"]
  shopId: string
}) => {
  const listPayload = await runBuyerScriptJson<ItemListingListOutput>(
    scriptRunner,
    "item-listing-list",
    {
      account,
      args: { shopId }
    }
  )

  return (listPayload.itemListings ?? []).map(
    (listing) => listing.itemListingId
  )
}

describe("owner item listing scripts integration", () => {
  it("adds item listings", async () => {
    await testEnv.withTestContext("owner-item-listing-add", async (context) => {
      const { publisher, scriptRunner, shopId, itemType } =
        await createShopWithItemType(context, "Item Listing Add Shop")

      const listingOutput = await runOwnerScriptJson<ItemListingOutput>(
        scriptRunner,
        "item-listing-add",
        {
          account: publisher,
          args: {
            shopId,
            name: DEFAULT_LISTING_INPUT.name,
            price: DEFAULT_LISTING_INPUT.priceUsd,
            stock: DEFAULT_LISTING_INPUT.stock,
            itemType
          }
        }
      )

      expectSuccessfulTransaction(listingOutput.transactionSummary)
      expectItemListingSummary(listingOutput.itemListing, {
        name: DEFAULT_LISTING_INPUT.name,
        itemType,
        basePriceUsdCents: DEFAULT_LISTING_INPUT.priceUsdCents,
        stock: DEFAULT_LISTING_INPUT.stock
      })
      expect(listingOutput.itemListing?.spotlightTemplateId).toBeUndefined()
    })
  })

  it("adds item listings with spotlight discounts", async () => {
    await testEnv.withTestContext(
      "owner-item-listing-add-spotlight",
      async (context) => {
        const { publisher, scriptRunner, shopId, itemType } =
          await createShopWithItemType(context, "Item Listing Spotlight Shop")

        const discountTemplate = await createDiscountTemplateFixture({
          scriptRunner,
          publisher,
          shopId,
          ruleKind: "percent",
          value: "10"
        })

        const listingOutput = await runOwnerScriptJson<ItemListingOutput>(
          scriptRunner,
          "item-listing-add",
          {
            account: publisher,
            args: {
              shopId,
              name: DEFAULT_LISTING_INPUT.name,
              price: DEFAULT_LISTING_INPUT.priceUsd,
              stock: DEFAULT_LISTING_INPUT.stock,
              itemType,
              spotlightDiscountId: discountTemplate.discountTemplateId
            }
          }
        )

        expectSuccessfulTransaction(listingOutput.transactionSummary)
        expectItemListingSummary(listingOutput.itemListing, {
          name: DEFAULT_LISTING_INPUT.name,
          itemType,
          basePriceUsdCents: DEFAULT_LISTING_INPUT.priceUsdCents,
          stock: DEFAULT_LISTING_INPUT.stock
        })
        expect(listingOutput.itemListing?.spotlightTemplateId).toBe(
          discountTemplate.discountTemplateId
        )
      }
    )
  })

  it("updates item listing stock", async () => {
    await testEnv.withTestContext(
      "owner-item-listing-update-stock",
      async (context) => {
        const { publisher, scriptRunner, shopId, itemType } =
          await createShopWithItemType(context, "Item Listing Stock Shop")
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: DEFAULT_LISTING_INPUT.name,
          price: DEFAULT_LISTING_INPUT.priceUsd,
          stock: DEFAULT_LISTING_INPUT.stock
        })

        const updateOutput = await runOwnerScriptJson<ItemListingOutput>(
          scriptRunner,
          "item-listing-update-stock",
          {
            account: publisher,
            args: {
              shopId,
              itemListingId: listing.itemListingId,
              stock: "7"
            }
          }
        )

        expectSuccessfulTransaction(updateOutput.transactionSummary)
        expectItemListingSummary(updateOutput.itemListing, {
          name: listing.name,
          itemType: listing.itemType,
          basePriceUsdCents: DEFAULT_LISTING_INPUT.priceUsdCents,
          stock: "7"
        })
      }
    )
  })

  it("removes item listings", async () => {
    await testEnv.withTestContext(
      "owner-item-listing-remove",
      async (context) => {
        const { publisher, scriptRunner, shopId, itemType } =
          await createShopWithItemType(context, "Item Listing Remove Shop")
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: DEFAULT_LISTING_INPUT.name,
          price: DEFAULT_LISTING_INPUT.priceUsd,
          stock: DEFAULT_LISTING_INPUT.stock
        })

        const removeOutput = await runOwnerScriptJson<RemoveItemListingOutput>(
          scriptRunner,
          "item-listing-remove",
          {
            account: publisher,
            args: {
              shopId,
              itemListingId: listing.itemListingId
            }
          }
        )

        expectSuccessfulTransaction(removeOutput.transactionSummary)
        expect(removeOutput.deleted).toBe(listing.itemListingId)

        const listingIds = await listItemListingIds({
          scriptRunner,
          account: publisher,
          shopId
        })

        expect(listingIds).not.toContain(listing.itemListingId)
      }
    )
  })

  it("attaches discount templates to item listings", async () => {
    await testEnv.withTestContext(
      "owner-item-listing-attach-discount",
      async (context) => {
        const { publisher, scriptRunner, shopId, itemType } =
          await createShopWithItemType(context, "Item Listing Discount Shop")
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: DEFAULT_LISTING_INPUT.name,
          price: DEFAULT_LISTING_INPUT.priceUsd,
          stock: DEFAULT_LISTING_INPUT.stock
        })

        const discountTemplate = await createDiscountTemplateFixture({
          scriptRunner,
          publisher,
          shopId,
          ruleKind: "percent",
          value: "10",
          listingId: listing.itemListingId
        })

        const attachOutput =
          await runOwnerScriptJson<AttachDiscountTemplateOutput>(
            scriptRunner,
            "item-listing-attach-discount-template",
            {
              account: publisher,
              args: {
                shopId,
                itemListingId: listing.itemListingId,
                discountTemplateId: discountTemplate.discountTemplateId
              }
            }
          )

        expectSuccessfulTransaction(attachOutput.transactionSummary)
        expect(attachOutput.itemListing?.itemListingId).toBe(
          listing.itemListingId
        )
        expect(attachOutput.itemListing?.spotlightTemplateId).toBe(
          discountTemplate.discountTemplateId
        )
        expect(attachOutput.discountTemplate?.discountTemplateId).toBe(
          discountTemplate.discountTemplateId
        )
      }
    )
  })

  it("clears item listing discount templates", async () => {
    await testEnv.withTestContext(
      "owner-item-listing-clear-discount",
      async (context) => {
        const { publisher, scriptRunner, shopId, itemType } =
          await createShopWithItemType(
            context,
            "Item Listing Clear Discount Shop"
          )
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: DEFAULT_LISTING_INPUT.name,
          price: DEFAULT_LISTING_INPUT.priceUsd,
          stock: DEFAULT_LISTING_INPUT.stock
        })

        const discountTemplate = await createDiscountTemplateFixture({
          scriptRunner,
          publisher,
          shopId,
          ruleKind: "percent",
          value: "10",
          listingId: listing.itemListingId
        })

        await attachDiscountTemplateToListing({
          scriptRunner,
          publisher,
          shopId,
          itemListingId: listing.itemListingId,
          discountTemplateId: discountTemplate.discountTemplateId
        })

        const clearOutput = await runOwnerScriptJson<ItemListingOutput>(
          scriptRunner,
          "item-listing-clear-discount-template",
          {
            account: publisher,
            args: {
              shopId,
              itemListingId: listing.itemListingId
            }
          }
        )

        expectSuccessfulTransaction(clearOutput.transactionSummary)
        expect(clearOutput.itemListing?.itemListingId).toBe(
          listing.itemListingId
        )
        expect(clearOutput.itemListing?.spotlightTemplateId).toBeUndefined()
      }
    )
  })
})
