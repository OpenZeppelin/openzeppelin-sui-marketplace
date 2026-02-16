import { type AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { NORMALIZED_SUI_COIN_TYPE } from "@sui-oracle-market/tooling-node/constants"
import type { TestContext } from "@sui-oracle-market/tooling-node/testing/localnet"
import { describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createFundedTestAccount,
  createItemListingFixture,
  createShopFixture,
  createShopWithAcceptedCurrencyFixture,
  createShopWithItemExamplesAndAcceptedCurrencyFixture,
  createShopWithItemExamplesFixture,
  createShopWithMockSetupFixture,
  resolveItemType,
  type CurrencyAddScriptOutput,
  runBuyerScriptJson,
  runOwnerScriptJson,
  seedShopWithListingAndDiscount
} from "./helpers.ts"

type ItemListingListOutput = {
  shopId?: string
  itemListings?: ItemListingSummary[]
}

type CurrencyListOutput = {
  shopId?: string
  acceptedCurrencies?: AcceptedCurrencySummary[]
}

type BuyOutput = {
  digest?: string
  mintTo?: string
  refundTo?: string
  createdItemIds?: string[]
  transactionSummary?: {
    status?: string
  }
}

type DiscountTicketClaimOutput = {
  discountTemplateId?: string
  claimedTicketId?: string
  digest?: string
  transactionSummary?: {
    status?: string
  }
}

const listAcceptedCurrencyCoinTypes = (
  acceptedCurrencies: AcceptedCurrencySummary[] = []
) => acceptedCurrencies.map((currency) => currency.coinType)

const expectSuccessfulTransaction = (status?: string) =>
  expect(status).toBe("success")

const expectSuccessfulBuyPayload = ({
  buyPayload,
  expectedMintTo,
  expectedRefundTo
}: {
  buyPayload: BuyOutput
  expectedMintTo: string
  expectedRefundTo: string
}) => {
  expectSuccessfulTransaction(buyPayload.transactionSummary?.status)
  expect(buyPayload.digest).toBeTruthy()
  expect(buyPayload.createdItemIds?.length).toBeGreaterThan(0)
  expect(buyPayload.mintTo).toBe(expectedMintTo)
  expect(buyPayload.refundTo).toBe(expectedRefundTo)
}

const requireDefined = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new Error(message)
  return value
}

const resolveFirstOwnedCoinObjectId = async ({
  context,
  ownerAddress,
  coinType
}: {
  context: TestContext
  ownerAddress: string
  coinType: string
}) => {
  const coinPage = await context.suiClient.getCoins({
    owner: ownerAddress,
    coinType,
    limit: 1
  })
  return coinPage.data[0]?.coinObjectId
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
        (itemListing) => itemListing.itemListingId
      )
      expect(listedIds).toContain(listing.itemListingId)
      expect(
        listPayload.itemListings?.some(
          (itemListing) => itemListing.itemType === itemType
        )
      ).toBe(true)
    })
  })

  it("lists accepted currencies registered by owner scripts", async () => {
    await testEnv.withTestContext("buyer-currency-list", async (context) => {
      const { publisher, scriptRunner, shopId, acceptedCurrency } =
        await createShopWithAcceptedCurrencyFixture(context, {
          shopName: "Buyer Currency List Integration",
          publisherLabel: "buyer-currency-owner"
        })

      const currencyListPayload = await runBuyerScriptJson<CurrencyListOutput>(
        scriptRunner,
        "currency-list",
        {
          account: publisher,
          args: { shopId }
        }
      )

      expect(currencyListPayload.shopId).toBe(shopId)
      expect(
        listAcceptedCurrencyCoinTypes(currencyListPayload.acceptedCurrencies)
      ).toContain(acceptedCurrency.coinType)
      const listedAcceptedCurrency =
        currencyListPayload.acceptedCurrencies?.find(
          (currency) => currency.coinType === acceptedCurrency.coinType
        )
      expect(listedAcceptedCurrency?.coinType).toBe(acceptedCurrency.coinType)
      expect(listedAcceptedCurrency?.feedIdHex).toBe(acceptedCurrency.feedIdHex)
      expect(listedAcceptedCurrency?.pythObjectId).toBe(
        acceptedCurrency.priceInfoObjectId
      )
    })
  })

  it("returns an empty list when no accepted currencies are registered", async () => {
    await testEnv.withTestContext(
      "buyer-currency-list-empty",
      async (context) => {
        const { publisher, scriptRunner, shopId } = await createShopFixture(
          context,
          {
            shopName: "Buyer Currency Empty List Integration"
          }
        )

        const currencyListPayload =
          await runBuyerScriptJson<CurrencyListOutput>(
            scriptRunner,
            "currency-list",
            {
              account: publisher,
              args: { shopId }
            }
          )

        expect(currencyListPayload.shopId).toBe(shopId)
        expect(currencyListPayload.acceptedCurrencies ?? []).toHaveLength(0)
      }
    )
  })

  it("buys an item with a registered accepted currency", async () => {
    await testEnv.withTestContext(
      "buyer-buy-accepted-currency",
      async (context) => {
        const buyer = await createFundedTestAccount(context, {
          label: "buyer"
        })
        const {
          publisher,
          scriptRunner,
          shopId,
          itemExamplesPackageId,
          acceptedCurrency
        } = await createShopWithItemExamplesAndAcceptedCurrencyFixture(
          context,
          {
            shopName: "Buyer Buy Integration",
            publisherLabel: "buyer-checkout-owner",
            buyerAddress: buyer.address
          }
        )

        const itemType = resolveItemType(itemExamplesPackageId, "Car")
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: "Buyer Checkout Car",
          price: "100",
          stock: "3"
        })

        const buyPayload = await runBuyerScriptJson<BuyOutput>(
          scriptRunner,
          "buy",
          {
            account: buyer,
            args: {
              shopId,
              itemListingId: listing.itemListingId,
              coinType: acceptedCurrency.coinType
            }
          }
        )

        expectSuccessfulBuyPayload({
          buyPayload,
          expectedMintTo: buyer.address,
          expectedRefundTo: buyer.address
        })
      }
    )
  })

  it("buys with explicit recipients and payment coin object", async () => {
    await testEnv.withTestContext(
      "buyer-buy-explicit-recipient-and-coin",
      async (context) => {
        const buyer = await createFundedTestAccount(context, {
          label: "buyer-explicit"
        })
        const mintRecipient = context.createAccount("mint-recipient")
        const refundRecipient = context.createAccount("refund-recipient")
        const {
          publisher,
          scriptRunner,
          shopId,
          itemExamplesPackageId,
          acceptedCurrency
        } = await createShopWithItemExamplesAndAcceptedCurrencyFixture(
          context,
          {
            shopName: "Buyer Buy Explicit Recipient Integration",
            publisherLabel: "buyer-checkout-owner",
            buyerAddress: buyer.address
          }
        )

        const itemType = resolveItemType(itemExamplesPackageId, "Car")
        const listing = await createItemListingFixture({
          scriptRunner,
          publisher,
          shopId,
          itemType,
          name: "Buyer Explicit Recipient Car",
          price: "100",
          stock: "3"
        })

        const paymentCoinObjectId = requireDefined(
          await resolveFirstOwnedCoinObjectId({
            context,
            ownerAddress: buyer.address,
            coinType: acceptedCurrency.coinType
          }),
          `Missing buyer coin for ${acceptedCurrency.coinType}.`
        )

        const buyPayload = await runBuyerScriptJson<BuyOutput>(
          scriptRunner,
          "buy",
          {
            account: buyer,
            args: {
              shopId,
              itemListingId: listing.itemListingId,
              coinType: acceptedCurrency.coinType,
              paymentCoinObjectId,
              mintTo: mintRecipient.address,
              refundTo: refundRecipient.address
            }
          }
        )

        expectSuccessfulBuyPayload({
          buyPayload,
          expectedMintTo: mintRecipient.address,
          expectedRefundTo: refundRecipient.address
        })
      }
    )
  })

  it("buys with a claimed discount ticket and accepted currency", async () => {
    await testEnv.withTestContext(
      "buyer-buy-discount-ticket",
      async (context) => {
        const buyer = await createFundedTestAccount(context, {
          label: "buyer-ticket"
        })
        const {
          publisher,
          scriptRunner,
          shopId,
          itemExamplesPackageId,
          acceptedCurrency
        } = await createShopWithItemExamplesAndAcceptedCurrencyFixture(
          context,
          {
            shopName: "Buyer Buy Discount Ticket Integration",
            publisherLabel: "buyer-checkout-owner",
            buyerAddress: buyer.address
          }
        )

        const itemType = resolveItemType(itemExamplesPackageId, "Car")
        const { itemListing, discountTemplate } =
          await seedShopWithListingAndDiscount({
            scriptRunner,
            publisher,
            shopId,
            itemType,
            listingName: "Buyer Discount Ticket Car",
            price: "100",
            stock: "3",
            ruleKind: "percent",
            value: "15"
          })

        const discountTicketClaimPayload =
          await runBuyerScriptJson<DiscountTicketClaimOutput>(
            scriptRunner,
            "discount-ticket-claim",
            {
              account: buyer,
              args: {
                shopId,
                discountTemplateId: discountTemplate.discountTemplateId
              }
            }
          )

        expectSuccessfulTransaction(
          discountTicketClaimPayload.transactionSummary?.status
        )

        const discountTicketId = requireDefined(
          discountTicketClaimPayload.claimedTicketId,
          "discount-ticket-claim did not return a claimedTicketId."
        )

        const buyPayload = await runBuyerScriptJson<BuyOutput>(
          scriptRunner,
          "buy",
          {
            account: buyer,
            args: {
              shopId,
              itemListingId: itemListing.itemListingId,
              coinType: acceptedCurrency.coinType,
              discountTicketId
            }
          }
        )

        expectSuccessfulBuyPayload({
          buyPayload,
          expectedMintTo: buyer.address,
          expectedRefundTo: buyer.address
        })
      }
    )
  })

  it("claims and buys with discount template using accepted currency", async () => {
    await testEnv.withTestContext(
      "buyer-buy-claim-discount",
      async (context) => {
        const buyer = await createFundedTestAccount(context, {
          label: "buyer-claim-discount"
        })
        const {
          publisher,
          scriptRunner,
          shopId,
          itemExamplesPackageId,
          acceptedCurrency
        } = await createShopWithItemExamplesAndAcceptedCurrencyFixture(
          context,
          {
            shopName: "Buyer Buy Claim Discount Integration",
            publisherLabel: "buyer-checkout-owner",
            buyerAddress: buyer.address
          }
        )

        const itemType = resolveItemType(itemExamplesPackageId, "Car")
        const { itemListing, discountTemplate } =
          await seedShopWithListingAndDiscount({
            scriptRunner,
            publisher,
            shopId,
            itemType,
            listingName: "Buyer Claim Discount Car",
            price: "100",
            stock: "3",
            ruleKind: "percent",
            value: "20"
          })

        const buyPayload = await runBuyerScriptJson<BuyOutput>(
          scriptRunner,
          "buy",
          {
            account: buyer,
            args: {
              shopId,
              itemListingId: itemListing.itemListingId,
              coinType: acceptedCurrency.coinType,
              claimDiscount: true,
              discountTemplateId: discountTemplate.discountTemplateId
            }
          }
        )

        expectSuccessfulBuyPayload({
          buyPayload,
          expectedMintTo: buyer.address,
          expectedRefundTo: buyer.address
        })
      }
    )
  })

  it("buys with native SUI accepted currency", async () => {
    await testEnv.withTestContext("buyer-buy-native-sui", async (context) => {
      const buyer = await createFundedTestAccount(context, {
        label: "buyer-native-sui",
        funding: {
          minimumCoinObjects: 2,
          minimumBalance: 80_000_000_000n
        }
      })
      const { publisher, scriptRunner, shopId, shopPackageId, mockArtifact } =
        await createShopWithMockSetupFixture(context, {
          shopName: "Buyer Buy Native SUI Integration",
          publisherLabel: "buyer-checkout-owner",
          buyerAddress: buyer.address
        })

      const suiPriceFeed = requireDefined(
        mockArtifact.priceFeeds?.find((priceFeed) =>
          priceFeed.label.toLowerCase().includes("sui")
        ),
        "mock setup did not produce a SUI price feed."
      )

      const currencyAddPayload =
        await runOwnerScriptJson<CurrencyAddScriptOutput>(
          scriptRunner,
          "currency-add",
          {
            account: publisher,
            args: {
              shopId,
              shopPackageId,
              coinType: NORMALIZED_SUI_COIN_TYPE,
              feedId: suiPriceFeed.feedIdHex,
              priceInfoObjectId: suiPriceFeed.priceInfoObjectId
            }
          }
        )

      expectSuccessfulTransaction(currencyAddPayload.transactionSummary?.status)
      expect(currencyAddPayload.acceptedCurrency?.tableEntryFieldId).toBeTruthy()

      const itemType = requireDefined(
        mockArtifact.itemTypes?.[0]?.itemType,
        "mock setup did not produce item types."
      )
      const listing = await createItemListingFixture({
        scriptRunner,
        publisher,
        shopId,
        itemType,
        name: "Buyer Native SUI Listing",
        price: "1",
        stock: "2"
      })

      const buyPayload = await runBuyerScriptJson<BuyOutput>(
        scriptRunner,
        "buy",
        {
          account: buyer,
          args: {
            shopId,
            itemListingId: listing.itemListingId,
            coinType: NORMALIZED_SUI_COIN_TYPE
          }
        }
      )

      expectSuccessfulBuyPayload({
        buyPayload,
        expectedMintTo: buyer.address,
        expectedRefundTo: buyer.address
      })
    })
  })
})
