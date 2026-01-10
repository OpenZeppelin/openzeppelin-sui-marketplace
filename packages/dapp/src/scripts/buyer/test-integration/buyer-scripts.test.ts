import { describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createItemListingFixture,
  createShopWithItemExamplesFixture,
  resolveItemType,
  runBuyerScriptJson
} from "./helpers.ts"

type ItemListingListOutput = {
  shopId?: string
  itemListings?: Array<{
    itemListingId?: string
    itemType?: string
    name?: string
  }>
}

const testEnv = createDappIntegrationTestEnv()

describe("buyer scripts integration", () => {
  it("lists item listings created by owner scripts", async () => {
    await testEnv.withTestContext("buyer-item-listings", async (context) => {
      const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
        await createShopWithItemExamplesFixture(context, {
          shopName: "Buyer Integration Shop"
        })

      const itemType = resolveItemType(itemExamplesPackageId, "Car")

      const listing = await createItemListingFixture({
        scriptRunner,
        publisher,
        shopId,
        name: "Roadster",
        price: "1250",
        stock: "4",
        itemType
      })

      const listPayload = await runBuyerScriptJson<ItemListingListOutput>(
        scriptRunner,
        "item-listing-list",
        {
          account: publisher,
          args: {
            shopId
          }
        }
      )

      const listedIds = (listPayload.itemListings ?? []).map(
        (listing) => listing.itemListingId
      )
      expect(listedIds).toContain(listing.itemListingId)
      expect(
        listPayload.itemListings?.some(
          (listing) => listing.itemType === itemType
        )
      ).toBe(true)
    })
  })
})
