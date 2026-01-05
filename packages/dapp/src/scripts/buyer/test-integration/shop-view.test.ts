import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createShopWithItemExamplesFixture,
  resolveItemType,
  runBuyerScriptJson,
  seedShopWithListingAndDiscount
} from "./helpers.ts"

type ShopViewOutput = {
  shopOverview?: {
    shopId?: string
    ownerAddress?: string
    name?: string
  }
  itemListings?: Array<{
    itemListingId?: string
    markerObjectId?: string
    itemType?: string
    name?: string
  }>
  acceptedCurrencies?: Array<{
    acceptedCurrencyId?: string
    markerObjectId?: string
    coinType?: string
    feedIdHex?: string
  }>
  discountTemplates?: Array<{
    discountTemplateId?: string
    markerObjectId?: string
    shopAddress?: string
    status?: string
  }>
}

const testEnv = createDappIntegrationTestEnv()

describe("buyer shop-view integration", () => {
  beforeAll(async () => {
    await testEnv.startSuite("dapp-buyer-shop-view")
  })

  afterAll(async () => {
    await testEnv.stopSuite()
  })

  it("returns seeded shop snapshot details", async () => {
    await testEnv.withTestContext("buyer-shop-view", async (context) => {
      const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
        await createShopWithItemExamplesFixture(context, {
          shopName: "Shop View Integration"
        })

      const itemType = resolveItemType(itemExamplesPackageId, "Car")
      await seedShopWithListingAndDiscount({
        scriptRunner,
        publisher,
        shopId,
        itemType,
        listingName: "Roadster",
        price: "1250",
        stock: "4",
        ruleKind: "percent",
        value: "10"
      })

      const viewPayload = await runBuyerScriptJson<ShopViewOutput>(
        scriptRunner,
        "shop-view",
        {
          account: publisher,
          args: { shopId }
        }
      )

      expect(viewPayload.shopOverview?.shopId).toBe(shopId)
      expect(viewPayload.shopOverview?.name).toBeTruthy()
      expect(viewPayload.shopOverview?.ownerAddress).toBeTruthy()

      const itemListings = viewPayload.itemListings ?? []
      expect(itemListings.length).toBeGreaterThan(0)
      itemListings.forEach((listing) => {
        expect(listing.itemListingId).toBeTruthy()
        expect(listing.markerObjectId).toBeTruthy()
        expect(listing.itemType).toBeTruthy()
        expect(listing.name).toBeTruthy()
      })

      const acceptedCurrencies = viewPayload.acceptedCurrencies ?? []
      expect(acceptedCurrencies.length).toBe(0)

      const discountTemplates = viewPayload.discountTemplates ?? []
      expect(discountTemplates.length).toBeGreaterThan(0)
      discountTemplates.forEach((template) => {
        expect(template.discountTemplateId).toBeTruthy()
        expect(template.markerObjectId).toBeTruthy()
        expect(template.shopAddress).toBeTruthy()
        expect(template.status).toBeTruthy()
      })
    })
  })
})
