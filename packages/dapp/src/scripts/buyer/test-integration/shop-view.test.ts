import { describe, expect, it } from "vitest"

import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type { DiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingDetails } from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import {
  createDappIntegrationTestEnv,
  createShopWithItemExamplesFixture,
  resolveItemType,
  runBuyerScriptJson,
  seedShopWithListingAndDiscount
} from "./helpers.ts"

type ShopViewOutput = {
  shopOverview?: ShopOverview
  itemListings?: Array<ItemListingDetails>
  acceptedCurrencies?: Array<AcceptedCurrencySummary>
  discountTemplates?: Array<DiscountTemplateSummary>
}

const testEnv = createDappIntegrationTestEnv()
const DEFAULT_LISTING_INPUT = {
  name: "Roadster",
  priceUsd: "12.50",
  priceUsdCents: "1250",
  stock: "4"
}

const findListingById = (
  listings: ShopViewOutput["itemListings"],
  listingId: string
) => (listings ?? []).find((listing) => listing.itemListingId === listingId)

describe("buyer shop-view integration", () => {
  it("returns seeded shop snapshot details", async () => {
    await testEnv.withTestContext("buyer-shop-view", async (context) => {
      const { publisher, scriptRunner, shopId, itemExamplesPackageId } =
        await createShopWithItemExamplesFixture(context, {
          shopName: "Shop View Integration"
        })

      const itemType = resolveItemType(itemExamplesPackageId, "Car")
      const { itemListing, discountTemplate } =
        await seedShopWithListingAndDiscount({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          listingName: DEFAULT_LISTING_INPUT.name,
          price: DEFAULT_LISTING_INPUT.priceUsd,
          stock: DEFAULT_LISTING_INPUT.stock,
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
      const seededListing = findListingById(
        viewPayload.itemListings,
        itemListing.itemListingId
      )
      expect(seededListing).toBeTruthy()
      itemListings.forEach((listing) => {
        expect(listing.itemListingId).toBeTruthy()
        expect(listing.markerObjectId).toBeTruthy()
        expect(listing.itemType).toBeTruthy()
        expect(listing.name).toBeTruthy()
      })
      expect(seededListing?.basePriceUsdCents).toBe(
        DEFAULT_LISTING_INPUT.priceUsdCents
      )
      expect(seededListing?.stock).toBe(DEFAULT_LISTING_INPUT.stock)
      expect(seededListing?.spotlightTemplateId).toBe(
        discountTemplate.discountTemplateId
      )

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
