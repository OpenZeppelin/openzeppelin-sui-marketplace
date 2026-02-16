import type { ShopSnapshot } from "@sui-oracle-market/domain-core/models/shop"
import { describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createShopWithItemExamplesAndAcceptedCurrencyFixture,
  createShopWithItemExamplesFixture,
  resolveItemType,
  runBuyerScriptJson,
  seedShopWithListingAndDiscount
} from "./helpers.ts"

const testEnv = createDappIntegrationTestEnv()

describe("buyer shop-view integration", () => {
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

      const viewPayload = await runBuyerScriptJson<ShopSnapshot>(
        scriptRunner,
        "shop-view",
        {
          account: publisher,
          args: { shopId }
        }
      )

      expect(viewPayload.shopOverview.shopId).toBe(shopId)
      expect(viewPayload.shopOverview.name).toBeTruthy()
      expect(viewPayload.shopOverview.ownerAddress).toBeTruthy()

      const itemListings = viewPayload.itemListings ?? []
      expect(itemListings.length).toBeGreaterThan(0)
      itemListings.forEach((itemListing) => {
        expect(itemListing.itemListingId).toBeTruthy()
        expect(itemListing.markerObjectId).toBeTruthy()
        expect(itemListing.itemType).toBeTruthy()
        expect(itemListing.name).toBeTruthy()
      })

      const acceptedCurrencies = viewPayload.acceptedCurrencies ?? []
      expect(acceptedCurrencies.length).toBe(0)

      const discountTemplates = viewPayload.discountTemplates ?? []
      expect(discountTemplates.length).toBeGreaterThan(0)
      discountTemplates.forEach((discountTemplate) => {
        expect(discountTemplate.discountTemplateId).toBeTruthy()
        expect(discountTemplate.markerObjectId).toBeTruthy()
        expect(discountTemplate.shopId).toBeTruthy()
        expect(discountTemplate.status).toBeTruthy()
      })
    })
  })

  it("returns accepted currency details after owner registration", async () => {
    await testEnv.withTestContext(
      "buyer-shop-view-currencies",
      async (context) => {
        const { publisher, scriptRunner, shopId, acceptedCurrency } =
          await createShopWithItemExamplesAndAcceptedCurrencyFixture(context, {
            shopName: "Shop View Currency Integration",
            publisherLabel: "shop-view-owner"
          })

        const viewPayload = await runBuyerScriptJson<ShopSnapshot>(
          scriptRunner,
          "shop-view",
          {
            account: publisher,
            args: { shopId }
          }
        )

        const acceptedCurrencies = viewPayload.acceptedCurrencies ?? []
        expect(acceptedCurrencies.length).toBeGreaterThan(0)
        expect(
          acceptedCurrencies.some(
            (currency) =>
              currency.tableEntryFieldId ===
                acceptedCurrency.tableEntryFieldId &&
              currency.coinType === acceptedCurrency.coinType &&
              currency.feedIdHex === acceptedCurrency.feedIdHex
          )
        ).toBe(true)
      }
    )
  })
})
