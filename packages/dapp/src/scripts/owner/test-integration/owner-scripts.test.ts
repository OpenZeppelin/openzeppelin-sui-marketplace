import {
  MAX_PRICE_AGE_SECS_CAP,
  type AcceptedCurrencySummary
} from "@sui-oracle-market/domain-core/models/currency"
import { NORMALIZED_SUI_COIN_TYPE } from "@sui-oracle-market/tooling-node/constants"
import { describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createShopFixture,
  createShopWithAcceptedCurrencyFixture,
  createShopWithMockSetupFixture,
  type CurrencyAddScriptOutput,
  resolveMockCurrencyFeedSelection,
  runOwnerScriptJson
} from "./helpers.ts"

type TransactionSummaryOutput = {
  status?: string
}

type ShopOverviewPayload = {
  shopOverview?: {
    shopId?: string
    ownerAddress?: string
    name?: string
  }
  transactionSummary?: TransactionSummaryOutput
}

type CurrencyRemovePayload = {
  removedCoinType?: string
  tableEntryFieldId?: string
  transactionSummary?: TransactionSummaryOutput
}

type ShopSeedPayload = {
  shopOverview?: {
    shopId?: string
  }
  acceptedCurrencies?: AcceptedCurrencySummary[]
  itemListings?: Array<{
    itemListingId?: string
  }>
  discountTemplates?: Array<{
    discountTemplateId?: string
  }>
}

const expectSuccessfulTransaction = (status?: string) =>
  expect(status).toBe("success")

const listCoinTypes = (acceptedCurrencies: AcceptedCurrencySummary[] = []) =>
  acceptedCurrencies.map((currency) => currency.coinType)

type ExpectedAcceptedCurrencyFields = {
  coinType: string
  feedIdHex: string
  tableEntryFieldId?: string
  pythObjectId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
}

const expectAcceptedCurrencyMatches = (
  acceptedCurrency: Partial<AcceptedCurrencySummary> | undefined,
  expected: ExpectedAcceptedCurrencyFields
) => {
  expect(acceptedCurrency).toBeDefined()
  expect(acceptedCurrency).toMatchObject(expected)
  if (!expected.tableEntryFieldId)
    expect(acceptedCurrency?.tableEntryFieldId).toBeTruthy()
}

const testEnv = createDappIntegrationTestEnv()

describe("owner scripts integration", () => {
  it("creates a shop and updates the owner", async () => {
    await testEnv.withTestContext(
      "shop-create-update-owner",
      async (context) => {
        const { publisher, scriptRunner, shopId, shopCreateOutput } =
          await createShopFixture(context, {
            shopName: "Integration Shop"
          })

        expect(shopCreateOutput.transactionSummary?.status).toBe("success")
        expect(shopCreateOutput.shopOverview?.shopId).toBeTruthy()

        const newOwner = context.createAccount("new-owner")
        const updatePayload = await runOwnerScriptJson<ShopOverviewPayload>(
          scriptRunner,
          "shop-update-owner",
          {
            account: publisher,
            args: {
              shopId,
              newOwner: newOwner.address
            }
          }
        )

        expect(updatePayload.transactionSummary?.status).toBe("success")
        expect(updatePayload.shopOverview?.ownerAddress).toBe(newOwner.address)
      }
    )
  })

  it("registers accepted currency with owner currency-add", async () => {
    await testEnv.withTestContext("owner-currency-add", async (context) => {
      const { acceptedCurrency } = await createShopWithAcceptedCurrencyFixture(
        context,
        {
          shopName: "Owner Currency Add Integration",
          publisherLabel: "owner-currency-publisher"
        }
      )

      const currencyAddPayload = acceptedCurrency.currencyAddOutput
      expectSuccessfulTransaction(currencyAddPayload.transactionSummary?.status)
      expect(currencyAddPayload.status).toBeUndefined()
      expectAcceptedCurrencyMatches(currencyAddPayload.acceptedCurrency, {
        coinType: acceptedCurrency.coinType,
        feedIdHex: acceptedCurrency.feedIdHex,
        tableEntryFieldId: acceptedCurrency.tableEntryFieldId,
        pythObjectId: acceptedCurrency.priceInfoObjectId
      })
    })
  })

  it("registers accepted currency with explicit currency registry object id", async () => {
    await testEnv.withTestContext(
      "owner-currency-add-explicit-currency-id",
      async (context) => {
        const { publisher, scriptRunner, shopId, shopPackageId, mockArtifact } =
          await createShopWithMockSetupFixture(context, {
            shopName: "Owner Currency Add Explicit Currency ID Integration",
            publisherLabel: "owner-currency-publisher"
          })

        const selection = resolveMockCurrencyFeedSelection({
          mockArtifact
        })
        const baseCurrencyAddArguments = {
          shopId,
          shopPackageId,
          coinType: selection.coinType,
          feedId: selection.feedIdHex,
          priceInfoObjectId: selection.priceInfoObjectId
        }

        const currencyAddPayload =
          await runOwnerScriptJson<CurrencyAddScriptOutput>(
            scriptRunner,
            "currency-add",
            {
              account: publisher,
              args: {
                ...baseCurrencyAddArguments,
                currencyId: selection.currencyObjectId
              }
            }
          )

        expectSuccessfulTransaction(
          currencyAddPayload.transactionSummary?.status
        )
        expectAcceptedCurrencyMatches(currencyAddPayload.acceptedCurrency, {
          coinType: selection.coinType,
          feedIdHex: selection.feedIdHex
        })
      }
    )
  })

  it("returns already-registered status when owner reruns currency-add", async () => {
    await testEnv.withTestContext(
      "owner-currency-add-already-registered",
      async (context) => {
        const {
          publisher,
          scriptRunner,
          shopId,
          shopPackageId,
          acceptedCurrency
        } = await createShopWithAcceptedCurrencyFixture(context, {
          shopName: "Owner Currency Add Existing Integration",
          publisherLabel: "owner-currency-publisher"
        })
        const baseCurrencyAddArguments = {
          shopId,
          shopPackageId,
          coinType: acceptedCurrency.coinType,
          feedId: acceptedCurrency.feedIdHex,
          priceInfoObjectId: acceptedCurrency.priceInfoObjectId
        }

        const existingCurrencyPayload =
          await runOwnerScriptJson<CurrencyAddScriptOutput>(
            scriptRunner,
            "currency-add",
            {
              account: publisher,
              args: baseCurrencyAddArguments
            }
          )

        expect(existingCurrencyPayload.status).toBe("already-registered")
        expect(existingCurrencyPayload.coinType).toBe(acceptedCurrency.coinType)
        expect(existingCurrencyPayload.transactionSummary).toBeUndefined()
        expectAcceptedCurrencyMatches(
          existingCurrencyPayload.acceptedCurrency,
          {
            coinType: acceptedCurrency.coinType,
            feedIdHex: acceptedCurrency.feedIdHex,
            tableEntryFieldId: acceptedCurrency.tableEntryFieldId
          }
        )
      }
    )
  })

  it("registers accepted currency guardrail caps with owner currency-add", async () => {
    await testEnv.withTestContext(
      "owner-currency-add-guardrails",
      async (context) => {
        const { publisher, scriptRunner, shopId, shopPackageId, mockArtifact } =
          await createShopWithMockSetupFixture(context, {
            shopName: "Owner Currency Add Guardrails Integration",
            publisherLabel: "owner-currency-publisher"
          })
        const selection = resolveMockCurrencyFeedSelection({
          mockArtifact
        })
        const baseCurrencyAddArguments = {
          shopId,
          shopPackageId,
          coinType: selection.coinType,
          feedId: selection.feedIdHex,
          priceInfoObjectId: selection.priceInfoObjectId
        }

        const currencyAddPayload =
          await runOwnerScriptJson<CurrencyAddScriptOutput>(
            scriptRunner,
            "currency-add",
            {
              account: publisher,
              args: {
                ...baseCurrencyAddArguments,
                maxPriceAgeSecsCap: "120",
                maxConfidenceRatioBpsCap: "250",
                maxPriceStatusLagSecsCap: "4"
              }
            }
          )

        expectSuccessfulTransaction(
          currencyAddPayload.transactionSummary?.status
        )
        expectAcceptedCurrencyMatches(currencyAddPayload.acceptedCurrency, {
          coinType: selection.coinType,
          feedIdHex: selection.feedIdHex,
          maxPriceAgeSecsCap: MAX_PRICE_AGE_SECS_CAP.toString(),
          maxConfidenceRatioBpsCap: "250",
          maxPriceStatusLagSecsCap: "4"
        })
      }
    )
  })

  it("removes accepted currency with owner currency-remove", async () => {
    await testEnv.withTestContext("owner-currency-remove", async (context) => {
      const {
        publisher,
        scriptRunner,
        shopId,
        shopPackageId,
        acceptedCurrency
      } = await createShopWithAcceptedCurrencyFixture(context, {
        shopName: "Owner Currency Remove Integration",
        publisherLabel: "owner-currency-publisher"
      })
      const baseCurrencyAddArguments = {
        shopId,
        shopPackageId,
        coinType: acceptedCurrency.coinType,
        feedId: acceptedCurrency.feedIdHex,
        priceInfoObjectId: acceptedCurrency.priceInfoObjectId
      }

      const removePayload = await runOwnerScriptJson<CurrencyRemovePayload>(
        scriptRunner,
        "currency-remove",
        {
          account: publisher,
          args: {
            shopId,
            coinType: acceptedCurrency.coinType
          }
        }
      )

      expectSuccessfulTransaction(removePayload.transactionSummary?.status)
      expect(removePayload.removedCoinType).toBe(acceptedCurrency.coinType)
      expect(removePayload.tableEntryFieldId).toBe(
        acceptedCurrency.tableEntryFieldId
      )

      const reAddPayload = await runOwnerScriptJson<CurrencyAddScriptOutput>(
        scriptRunner,
        "currency-add",
        {
          account: publisher,
          args: baseCurrencyAddArguments
        }
      )

      expectSuccessfulTransaction(reAddPayload.transactionSummary?.status)
      expectAcceptedCurrencyMatches(reAddPayload.acceptedCurrency, {
        coinType: acceptedCurrency.coinType,
        feedIdHex: acceptedCurrency.feedIdHex
      })
    })
  })

  it("removes accepted currency with owner currency-remove using --type alias", async () => {
    await testEnv.withTestContext(
      "owner-currency-remove-by-type-alias",
      async (context) => {
        const {
          publisher,
          scriptRunner,
          shopId,
          shopPackageId,
          acceptedCurrency
        } = await createShopWithAcceptedCurrencyFixture(context, {
          shopName: "Owner Currency Remove by ID Integration",
          publisherLabel: "owner-currency-publisher"
        })
        const baseCurrencyAddArguments = {
          shopId,
          shopPackageId,
          coinType: acceptedCurrency.coinType,
          feedId: acceptedCurrency.feedIdHex,
          priceInfoObjectId: acceptedCurrency.priceInfoObjectId
        }

        const removePayload = await runOwnerScriptJson<CurrencyRemovePayload>(
          scriptRunner,
          "currency-remove",
          {
            account: publisher,
            args: {
              shopId,
              type: acceptedCurrency.coinType
            }
          }
        )

        expectSuccessfulTransaction(removePayload.transactionSummary?.status)
        expect(removePayload.removedCoinType).toBe(acceptedCurrency.coinType)
        expect(removePayload.tableEntryFieldId).toBe(
          acceptedCurrency.tableEntryFieldId
        )

        const reAddPayload = await runOwnerScriptJson<CurrencyAddScriptOutput>(
          scriptRunner,
          "currency-add",
          {
            account: publisher,
            args: baseCurrencyAddArguments
          }
        )

        expectSuccessfulTransaction(reAddPayload.transactionSummary?.status)
        expectAcceptedCurrencyMatches(reAddPayload.acceptedCurrency, {
          coinType: acceptedCurrency.coinType,
          feedIdHex: acceptedCurrency.feedIdHex
        })
      }
    )
  })

  it("seeds accepted currencies with owner shop-seed", async () => {
    await testEnv.withTestContext(
      "owner-shop-seed-currencies",
      async (context) => {
        const { publisher, scriptRunner, shopId, shopPackageId, mockArtifact } =
          await createShopWithMockSetupFixture(context, {
            shopName: "Owner Shop Seed Integration",
            publisherLabel: "owner-currency-publisher"
          })

        const shopSeedPayload = await runOwnerScriptJson<ShopSeedPayload>(
          scriptRunner,
          "shop-seed",
          {
            account: publisher,
            args: {
              shopId,
              shopPackageId
            }
          }
        )

        expect(shopSeedPayload.shopOverview?.shopId).toBe(shopId)

        const acceptedCurrencies = shopSeedPayload.acceptedCurrencies ?? []
        expect(acceptedCurrencies.length).toBeGreaterThan(0)
        expect(listCoinTypes(acceptedCurrencies)).toContain(
          NORMALIZED_SUI_COIN_TYPE
        )

        const firstMockCoinType = mockArtifact.coins?.[0]?.coinType
        if (firstMockCoinType) {
          expect(listCoinTypes(acceptedCurrencies)).toContain(firstMockCoinType)
        }

        expect((shopSeedPayload.itemListings ?? []).length).toBeGreaterThan(0)
        expect(
          (shopSeedPayload.discountTemplates ?? []).length
        ).toBeGreaterThan(0)
      }
    )
  })
})
