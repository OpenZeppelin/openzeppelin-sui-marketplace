/**
 * Seeds a Shop with sample listings, currencies, and discounts.
 * Uses localnet mock artifacts or testnet coins/feeds depending on network.
 */
import path from "node:path"

import type { SuiClient, SuiObjectResponse } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId, parseStructTag } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  findAcceptedCurrencyByCoinType,
  getAcceptedCurrencySummary,
  getAcceptedCurrencySummaries,
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType,
  type AcceptedCurrencyMatch
} from "@sui-oracle-market/domain-core/models/currency"
import {
  defaultStartTimestampSeconds,
  DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
  getDiscountTemplateSummaries,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel,
  type DiscountTemplateSummary
} from "@sui-oracle-market/domain-core/models/discount"
import {
  getItemListingSummaries,
  getItemListingSummary,
  type ItemListingSummary
} from "@sui-oracle-market/domain-core/models/item-listing"
import {
  requirePythPullOracleConfig,
  resolvePythPullOracleConfig
} from "@sui-oracle-market/domain-core/models/pyth"
import {
  createPythClient,
  formatPythFeedCandidates,
  normalizePythFeedId,
  resolvePythFeedResolution,
  resolvePythPriceInfoObjectId
} from "@sui-oracle-market/domain-core/models/pyth-feeds"
import type { ShopIdentifiers } from "@sui-oracle-market/domain-core/models/shop"
import {
  getShopOverview,
  parseUsdToCents
} from "@sui-oracle-market/domain-core/models/shop"
import { buildAddAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import {
  buildAddItemListingTransaction,
  buildAttachDiscountTemplateTransaction,
  validateTemplateAndListing
} from "@sui-oracle-market/domain-core/ptb/item-listing"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { resolveItemExamplesPackageId } from "@sui-oracle-market/domain-node/item-example"
import {
  assertPriceInfoObjectDependency,
  resolveMaybeLatestShopIdentifiers,
  resolveShopDependencyIds,
  resolveShopPackageId
} from "@sui-oracle-market/domain-node/shop"
import {
  assertBytesLength,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import { isStaleObjectVersionError } from "@sui-oracle-market/tooling-core/transactions"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { readMoveString } from "@sui-oracle-market/tooling-core/utils/formatters"
import { extractStructNameFromType } from "@sui-oracle-market/tooling-core/utils/type-name"
import {
  parseNonNegativeU64,
  parseOptionalPositiveU64,
  parseOptionalU64,
  parsePositiveU64,
  wait
} from "@sui-oracle-market/tooling-core/utils/utility"
import { retryWithDelay } from "@sui-oracle-market/tooling-core/utils/retry"
import { readArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { withMutedConsole } from "@sui-oracle-market/tooling-node/console"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_COIN_REGISTRY_ID
} from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { publishMovePackageWithFunding } from "@sui-oracle-market/tooling-node/publish"
import {
  ensureCreatedObject,
  findCreatedArtifactIdBySuffix,
  requireCreatedArtifactIdBySuffix
} from "@sui-oracle-market/tooling-node/transactions"
import {
  logAcceptedCurrencySummary,
  logDiscountTemplateSummary,
  logItemListingSummary,
  logShopOverview
} from "../../utils/log-summaries.ts"
import type { MockArtifact } from "../../utils/mocks.ts"
import { mockArtifactPath, writeMockArtifact } from "../../utils/mocks.ts"

// NOTE: Testnet coin package IDs can change over time.
// If this ever fails to resolve via the coin registry, run:
//   pnpm -s script owner:pyth:list --network testnet --query usdc --quote USD --limit 5
// and pick a `Coin-type`/`Currency-id` pair that matches the coin you can acquire.
const DEFAULT_USDC_COIN_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC"
// Native SUI coin type; used on testnet to support SUI payments.
const DEFAULT_SUI_COIN_TYPE = "0x2::sui::SUI"
// NOTE: Testnet coin package IDs can change over time.
// If this ever fails to resolve via the coin registry, run:
//   pnpm -s script owner:pyth:list --network testnet --query wal --quote USD --limit 5
// and pick a `Coin-type`/`Currency-id` pair that matches the coin you can acquire.
const DEFAULT_WAL_COIN_TYPE =
  "0xa7f7382f67ef48972ad6a92677f2a764201041f5e29c7a9e0389b75e61038cdf::wal::WAL"
// Pyth feed ids are resolved at runtime from Hermes using the coin symbol + quote.
const DEFAULT_PYTH_QUOTE_SYMBOL = "USD"
const DEFAULT_SHOP_NAME = "Shop"
const DEFAULT_ITEM_MODULE = "items"
const ITEM_EXAMPLES_PACKAGE_NAME = "item-examples"
const ITEM_TYPE_LOOKUP_RETRY_DELAY_MS = 1_500
const ITEM_TYPE_LOOKUP_MAX_ATTEMPTS = 6
const STALE_OBJECT_RETRY_DELAY_MS = 750
const STALE_OBJECT_RETRY_MAX_ATTEMPTS = 3

type SignAndExecuteResult = Awaited<ReturnType<Tooling["signAndExecute"]>>

const signAndExecuteWithRetry = async ({
  buildTransaction,
  tooling,
  maxAttempts = STALE_OBJECT_RETRY_MAX_ATTEMPTS
}: {
  buildTransaction: () => Transaction
  tooling: Tooling
  maxAttempts?: number
}): Promise<SignAndExecuteResult> =>
  retryWithDelay({
    action: () =>
      tooling.signAndExecute({
        transaction: buildTransaction(),
        signer: tooling.loadedEd25519KeyPair
      }),
    shouldRetry: isStaleObjectVersionError,
    maxAttempts,
    delayMs: STALE_OBJECT_RETRY_DELAY_MS
  })

type ShopSeedArguments = {
  shopName?: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemPackageId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
  json?: boolean
}

type ItemListingSeedDefinition = {
  name: string
  priceUsd: string
  stock: string
  itemTypeName: string
}

type ItemListingSeed = {
  name: string
  priceUsd: string
  stock: string
  itemType: string
}

type DiscountSeedDefinition = {
  ruleKind: DiscountRuleKindLabel
  value: string
  maxRedemptions?: string
}

type DiscountTemplateMap = Record<
  "fixed" | "percent",
  { discountTemplateId: string } | undefined
>

type AcceptedCurrencySeedInput = {
  coinType: string
}

type AcceptedCurrencySeed = {
  coinType: string
  feedId: string
  priceInfoObjectId: string
  currencyId?: string
}

const ACCEPTED_CURRENCY_SEEDS: AcceptedCurrencySeedInput[] = [
  { coinType: DEFAULT_SUI_COIN_TYPE },
  { coinType: DEFAULT_USDC_COIN_TYPE },
  { coinType: DEFAULT_WAL_COIN_TYPE }
]

type MockPriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]
type MockCoinArtifact = NonNullable<MockArtifact["coins"]>[number]
type DiscountTemplateEntry = Awaited<
  ReturnType<typeof getDiscountTemplateSummaries>
>[number]

const LISTING_SEEDS: ItemListingSeedDefinition[] = [
  {
    name: "City Commuter Car",
    priceUsd: "12.5",
    stock: "3",
    itemTypeName: "Car"
  },
  {
    name: "Metro Bike",
    priceUsd: "7.25",
    stock: "12",
    itemTypeName: "Bike"
  },
  {
    name: "Live Concert Ticket",
    priceUsd: "10",
    stock: "20",
    itemTypeName: "ConcertTicket"
  },
  {
    name: "Digital Pass",
    priceUsd: "4.5",
    stock: "40",
    itemTypeName: "DigitalPass"
  }
]

const DISCOUNT_SEEDS: DiscountSeedDefinition[] = [
  {
    ruleKind: "percent",
    value: "10"
  },
  {
    ruleKind: "fixed",
    value: "2",
    maxRedemptions: "25"
  }
]

const FIXED_DISCOUNT_LISTING_NAME = "Metro Bike"

runSuiScript(
  async (tooling, cliArguments: ShopSeedArguments) => {
    const seedShop = async () => {
      const networkName = tooling.network.networkName
      const suiClient = tooling.suiClient

      const shopIdentifiers = await resolveOrCreateShopIdentifiers({
        cliArguments,
        networkName,
        tooling
      })

      const shopOverview = await getShopOverview(
        shopIdentifiers.shopId,
        suiClient
      )
      logShopOverview(shopOverview)

      const { listingSeeds } = await resolveItemListingSeeds({
        cliArguments,
        networkName,
        tooling,
        suiClient
      })

      const acceptedCurrencySeeds = await resolveAcceptedCurrencySeeds({
        networkName,
        shopPackageId: shopIdentifiers.packageId,
        tooling
      })
      await ensureAcceptedCurrencies({
        acceptedCurrencySeeds,
        cliArguments,
        shopIdentifiers,
        tooling,
        suiClient
      })

      const itemListingSummaries = await ensureItemListings({
        listingSeeds,
        shopIdentifiers,
        tooling,
        suiClient
      })

      const discountTemplateSummaries = await ensureDiscountTemplates({
        discountSeeds: DISCOUNT_SEEDS,
        shopIdentifiers,
        tooling,
        suiClient
      })

      await ensureFixedDiscountSpotlight({
        fixedTemplateSummary: discountTemplateSummaries.fixed,
        preferredListingName: FIXED_DISCOUNT_LISTING_NAME,
        itemListingSummaries,
        shopIdentifiers,
        tooling,
        suiClient
      })

      const acceptedCurrencies = cliArguments.json
        ? await getAcceptedCurrencySummaries(shopIdentifiers.shopId, suiClient)
        : []

      return {
        shopOverview,
        acceptedCurrencies,
        itemListings: itemListingSummaries,
        discountTemplates: Object.values(discountTemplateSummaries).filter(
          (template): template is DiscountTemplateSummary =>
            template !== undefined
        )
      }
    }

    const seedResult = cliArguments.json
      ? await withMutedConsole(seedShop)
      : await seedShop()

    if (emitJsonOutput(seedResult, cliArguments.json)) return
  },
  yargs()
    .option("shopName", {
      alias: ["shop-name", "name"],
      type: "string",
      description: "Shop name to store on-chain when creating a new shop.",
      default: DEFAULT_SHOP_NAME
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest publish entry when omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID authorizing mutations; defaults to the latest artifact when omitted."
    })
    .option("itemPackageId", {
      alias: ["item-package-id", "item-examples-package-id"],
      type: "string",
      description:
        "Package ID for item-examples Move package; inferred from the latest publish entry when omitted."
    })
    .option("maxPriceAgeSecsCap", {
      alias: ["max-price-age-secs-cap", "max-price-age"],
      type: "string",
      description:
        "Optional seller guardrail for maximum price age in seconds. Leave empty to use the module default."
    })
    .option("maxConfidenceRatioBpsCap", {
      alias: ["max-confidence-ratio-bps-cap", "max-confidence-bps"],
      type: "string",
      description:
        "Optional guardrail for maximum confidence ratio (basis points). Leave empty to use the module default."
    })
    .option("maxPriceStatusLagSecsCap", {
      alias: ["max-price-status-lag-secs-cap", "max-status-lag"],
      type: "string",
      description:
        "Optional guardrail for maximum attestation lag in seconds. Leave empty to use the module default."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const resolveOrCreateShopIdentifiers = async ({
  cliArguments,
  networkName,
  tooling
}: {
  cliArguments: ShopSeedArguments
  networkName: string
  tooling: Tooling
}): Promise<ShopIdentifiers> => {
  const hasExplicitShopInputs =
    Boolean(cliArguments.shopId) || Boolean(cliArguments.ownerCapId)

  const existingIdentifiers = await resolveExistingShopIdentifiers({
    cliArguments,
    networkName,
    allowMissing: !hasExplicitShopInputs
  })
  if (
    existingIdentifiers?.packageId &&
    existingIdentifiers?.shopId &&
    existingIdentifiers?.ownerCapId
  )
    return existingIdentifiers as ShopIdentifiers

  const shopPackageId = await resolveShopPackageId({
    networkName,
    shopPackageId: cliArguments.shopPackageId
  })
  const shopName = cliArguments.shopName ?? DEFAULT_SHOP_NAME

  logKeyValueBlue("Shop")("Creating shop from published package.")

  const {
    objectArtifacts: { created }
  } = await signAndExecuteWithRetry({
    tooling,
    buildTransaction: () =>
      buildCreateShopTransaction({
        packageId: shopPackageId,
        shopName
      })
  })

  const shopId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: created,
    suffix: "::shop::Shop",
    label: "Shop"
  })
  const ownerCapId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: created,
    suffix: "::shop::ShopOwnerCap",
    label: "ShopOwnerCap"
  })

  return {
    packageId: shopPackageId,
    shopId,
    ownerCapId
  }
}

const resolveExistingShopIdentifiers = async ({
  cliArguments,
  networkName,
  allowMissing
}: {
  cliArguments: ShopSeedArguments
  networkName: string
  allowMissing: boolean
}) => {
  try {
    return await resolveMaybeLatestShopIdentifiers(
      {
        packageId: cliArguments.shopPackageId,
        shopId: cliArguments.shopId,
        ownerCapId: cliArguments.ownerCapId
      },
      networkName
    )
  } catch (error) {
    if (!allowMissing) throw error
    return undefined
  }
}

const buildItemListingSeeds = (itemPackageId: string): ItemListingSeed[] => {
  const normalizedPackageId = normalizeSuiObjectId(itemPackageId)
  const buildItemType = (itemTypeName: string) =>
    `${normalizedPackageId}::${DEFAULT_ITEM_MODULE}::${itemTypeName}`

  return LISTING_SEEDS.map((seed) => ({
    name: seed.name,
    priceUsd: seed.priceUsd,
    stock: seed.stock,
    itemType: buildItemType(seed.itemTypeName)
  }))
}

const resolveItemExamplesPackageIdForNetwork = async ({
  networkName,
  itemPackageId
}: {
  networkName: string
  itemPackageId?: string
}) => {
  const resolvedPackageId = await resolveItemExamplesPackageId({
    networkName,
    itemPackageId
  })

  if (networkName === "localnet") {
    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const mockItemPackageId = mockArtifact.itemPackageId
    if (mockItemPackageId) return normalizeSuiObjectId(mockItemPackageId)
  }

  return resolvedPackageId
}

const resolveItemExamplesPackagePath = (tooling: Tooling) =>
  path.join(tooling.suiConfig.paths.move, ITEM_EXAMPLES_PACKAGE_NAME)

const findMissingItemTypes = async ({
  listingSeeds,
  suiClient
}: {
  listingSeeds: ItemListingSeed[]
  suiClient: SuiClient
}): Promise<string[]> => {
  const uniqueItemTypes = [
    ...new Set(listingSeeds.map((listing) => listing.itemType))
  ]

  const missingItemTypes = await Promise.all(
    uniqueItemTypes.map(async (itemType) => {
      const { address, module, name } = parseStructTag(itemType)

      try {
        await suiClient.getNormalizedMoveStruct({
          package: normalizeSuiObjectId(address),
          module,
          struct: name
        })
        return undefined
      } catch {
        return itemType
      }
    })
  )

  return missingItemTypes.filter(Boolean) as string[]
}

const buildMissingItemTypesError = ({
  missingItemTypes,
  networkName
}: {
  missingItemTypes: string[]
  networkName: string
}) => {
  const artifactPath = `deployments/deployment.${networkName}.json`
  const missingTypeSummary =
    missingItemTypes.length === 1
      ? missingItemTypes[0]
      : missingItemTypes.join(", ")
  const publishCommand =
    networkName === "localnet"
      ? "pnpm --filter dapp mock:setup -- --re-publish"
      : "pnpm --filter dapp move:publish -- --package-path item-examples --re-publish"

  return new Error(
    `Failed to locate ${missingTypeSummary} on ${networkName}. Ensure the item-examples package is published and recorded in ${artifactPath} (run \`${publishCommand}\`).`
  )
}

const ensureListingTypesAvailable = async ({
  listingSeeds,
  networkName,
  suiClient
}: {
  listingSeeds: ItemListingSeed[]
  networkName: string
  suiClient: SuiClient
}) => {
  let missingItemTypes = await findMissingItemTypes({
    listingSeeds,
    suiClient
  })
  if (!missingItemTypes.length) return

  for (let attempt = 0; attempt < ITEM_TYPE_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    await wait(ITEM_TYPE_LOOKUP_RETRY_DELAY_MS)
    missingItemTypes = await findMissingItemTypes({
      listingSeeds,
      suiClient
    })
    if (!missingItemTypes.length) return
  }

  throw buildMissingItemTypesError({ missingItemTypes, networkName })
}

const publishItemExamplesPackage = async ({
  networkName,
  tooling
}: {
  networkName: string
  tooling: Tooling
}) => {
  logWarning(
    `Missing item types detected on ${networkName}; publishing item-examples.`
  )

  const publishArtifact = await publishMovePackageWithFunding({
    tooling,
    packagePath: resolveItemExamplesPackagePath(tooling),
    clearPublishedEntry: true,
    useCliPublish: false
  })

  const publishedPackageId = normalizeSuiObjectId(publishArtifact.packageId)

  if (networkName === "localnet") {
    await writeMockArtifact(mockArtifactPath, {
      itemPackageId: publishedPackageId
    })
  }

  return publishedPackageId
}

const resolveItemListingSeeds = async ({
  cliArguments,
  networkName,
  tooling,
  suiClient
}: {
  cliArguments: ShopSeedArguments
  networkName: string
  tooling: Tooling
  suiClient: SuiClient
}): Promise<{ itemPackageId: string; listingSeeds: ItemListingSeed[] }> => {
  const itemPackageId = await resolveItemExamplesPackageIdForNetwork({
    networkName,
    itemPackageId: cliArguments.itemPackageId
  })
  const listingSeeds = buildItemListingSeeds(itemPackageId)

  const missingItemTypes = await findMissingItemTypes({
    listingSeeds,
    suiClient
  })

  if (!missingItemTypes.length) return { itemPackageId, listingSeeds }

  if (cliArguments.itemPackageId)
    throw buildMissingItemTypesError({ missingItemTypes, networkName })

  const publishedItemPackageId = await publishItemExamplesPackage({
    networkName,
    tooling
  })
  const refreshedListingSeeds = buildItemListingSeeds(publishedItemPackageId)

  await ensureListingTypesAvailable({
    listingSeeds: refreshedListingSeeds,
    networkName,
    suiClient
  })

  return {
    itemPackageId: publishedItemPackageId,
    listingSeeds: refreshedListingSeeds
  }
}

const resolveAcceptedCurrencySeeds = async ({
  networkName,
  shopPackageId,
  tooling
}: {
  networkName: string
  shopPackageId: string
  tooling: Tooling
}): Promise<AcceptedCurrencySeed[]> => {
  if (networkName === "testnet")
    return resolveTestnetAcceptedCurrencySeeds({
      shopPackageId,
      tooling
    })
  if (networkName === "localnet") return buildLocalnetAcceptedCurrencySeeds()

  throw new Error(
    `shop-seed only supports testnet and localnet networks (received ${networkName}).`
  )
}

const resolveTestnetAcceptedCurrencySeeds = async ({
  shopPackageId,
  tooling
}: {
  shopPackageId: string
  tooling: Tooling
}): Promise<AcceptedCurrencySeed[]> => {
  const pythConfig = requirePythPullOracleConfig(
    resolvePythPullOracleConfig("testnet")
  )
  const pythClient = createPythClient({
    suiClient: tooling.suiClient,
    pythStateId: pythConfig.pythStateId,
    wormholeStateId: pythConfig.wormholeStateId
  })
  const dependencyIds = await resolveShopDependencyIds({
    networkName: "testnet",
    shopPackageId
  })

  return Promise.all(
    ACCEPTED_CURRENCY_SEEDS.map(async (seed) => {
      const normalizedCoinType = normalizeCoinType(seed.coinType)
      const { currencyId, symbol } = await resolveCurrencyRegistrySummary({
        coinType: normalizedCoinType,
        tooling
      })
      const baseSymbol = symbol ?? extractStructNameFromType(normalizedCoinType)

      const feedResolution = await resolvePythFeedResolution({
        hermesUrl: pythConfig.hermesUrl,
        baseSymbol,
        quoteSymbol: DEFAULT_PYTH_QUOTE_SYMBOL
      })

      if (!feedResolution.selected) {
        if (feedResolution.candidates.length > 1) {
          throw new Error(
            `Multiple Pyth feeds match ${baseSymbol}/${DEFAULT_PYTH_QUOTE_SYMBOL}: ${formatPythFeedCandidates(
              feedResolution.candidates
            )}`
          )
        }

        throw new Error(
          `Unable to resolve a Pyth feed for ${baseSymbol}/${DEFAULT_PYTH_QUOTE_SYMBOL}. Run \`pnpm -s script owner:pyth:list --network testnet --query ${baseSymbol} --quote ${DEFAULT_PYTH_QUOTE_SYMBOL} --limit 5\` to inspect available feeds.`
        )
      }

      const feedId = normalizePythFeedId(feedResolution.selected.feedId)

      const priceInfoObjectId = await resolvePythPriceInfoObjectId({
        pythClient,
        feedId
      })

      if (!priceInfoObjectId) {
        throw new Error(
          `Unable to resolve Pyth PriceInfoObject id for feed ${feedId}. Run \`pnpm -s script owner:pyth:list --network testnet --query ${baseSymbol} --quote ${DEFAULT_PYTH_QUOTE_SYMBOL} --limit 5\` to verify the feed.`
        )
      }

      await assertPriceInfoObjectDependency({
        priceInfoObjectId,
        dependencyIds,
        suiClient: tooling.suiClient
      })

      return {
        coinType: normalizedCoinType,
        feedId,
        priceInfoObjectId,
        currencyId
      }
    })
  )
}

const resolveCurrencyRegistrySummary = async ({
  coinType,
  tooling
}: {
  coinType: string
  tooling: Pick<Tooling, "resolveCurrencyObjectId" | "suiClient">
}): Promise<{ currencyId: string; symbol?: string }> => {
  const currencyId = await tooling.resolveCurrencyObjectId({
    coinType,
    registryId: SUI_COIN_REGISTRY_ID,
    fallbackRegistryScan: true
  })

  if (!currencyId)
    throw new Error(
      `Could not resolve currency registry entry for ${coinType}. Provide an updated coin type or register the coin first.`
    )

  const currencyObject = await tooling.suiClient.getObject({
    id: currencyId,
    options: { showContent: true, showType: true }
  })

  return {
    currencyId: normalizeSuiObjectId(currencyId),
    symbol: readCurrencySymbol(currencyObject)
  }
}

const readCurrencySymbol = (object: SuiObjectResponse) => {
  const data = object.data
  if (!data?.content || data.content.dataType !== "moveObject") return undefined

  const fields = data.content.fields as Record<string, unknown>
  return readMoveString(fields.symbol)
}

const buildLocalnetAcceptedCurrencySeeds = async (): Promise<
  AcceptedCurrencySeed[]
> => {
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
  const coins = mockArtifact.coins ?? []
  const priceFeeds = mockArtifact.priceFeeds ?? []

  if (!coins.length || !priceFeeds.length)
    throw new Error(
      "Localnet mock data is missing coins or price feeds. Run `pnpm --filter dapp mock:setup` first."
    )

  const initialState: {
    seeds: AcceptedCurrencySeed[]
    usedFeedIds: Set<string>
  } = { seeds: [], usedFeedIds: new Set<string>() }

  return coins.reduce((state, coin) => {
    const feed = pickMockFeedForCoin({
      coin,
      priceFeeds,
      usedFeedIds: state.usedFeedIds
    })
    if (!feed)
      throw new Error(
        `No mock price feed found for ${coin.label ?? coin.coinType}.`
      )

    const nextUsedFeedIds = new Set(state.usedFeedIds)
    nextUsedFeedIds.add(feed.feedIdHex)

    return {
      seeds: [
        ...state.seeds,
        {
          coinType: coin.coinType,
          feedId: feed.feedIdHex,
          priceInfoObjectId: feed.priceInfoObjectId,
          currencyId: coin.currencyObjectId
        }
      ],
      usedFeedIds: nextUsedFeedIds
    }
  }, initialState).seeds
}

const pickMockFeedForCoin = ({
  coin,
  priceFeeds,
  usedFeedIds
}: {
  coin: MockCoinArtifact
  priceFeeds: MockPriceFeedArtifact[]
  usedFeedIds: Set<string>
}) => {
  const coinKey = resolveMockLabelKey(coin.label)
  if (coinKey) {
    const matchedFeed = priceFeeds.find((feed) => {
      if (usedFeedIds.has(feed.feedIdHex)) return false
      const feedKey = resolveMockLabelKey(feed.label)
      return feedKey === coinKey
    })
    if (matchedFeed) return matchedFeed
  }

  return priceFeeds.find((feed) => !usedFeedIds.has(feed.feedIdHex))
}

const resolveMockLabelKey = (label?: string): string | undefined => {
  const normalized = label?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("usd")) return "usd"
  if (normalized.includes("btc")) return "btc"
  return normalized
}

const runSequentially = async <TItem, TResult>(
  items: TItem[],
  runner: (item: TItem) => Promise<TResult>
): Promise<TResult[]> =>
  items.reduce<Promise<TResult[]>>(async (pendingResults, item) => {
    const results = await pendingResults
    const nextResult = await runner(item)
    return [...results, nextResult]
  }, Promise.resolve([]))

const ensureAcceptedCurrencies = async ({
  acceptedCurrencySeeds,
  cliArguments,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  acceptedCurrencySeeds: AcceptedCurrencySeed[]
  cliArguments: ShopSeedArguments
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Tooling
  suiClient: SuiClient
}) => {
  await runSequentially(acceptedCurrencySeeds, (currencySeed) =>
    ensureAcceptedCurrency({
      currencySeed,
      cliArguments,
      shopIdentifiers,
      tooling,
      suiClient
    })
  )
}

const ensureAcceptedCurrency = async ({
  currencySeed,
  cliArguments,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  currencySeed: AcceptedCurrencySeed
  cliArguments: ShopSeedArguments
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Tooling
  suiClient: SuiClient
}) => {
  const coinType = normalizeCoinType(currencySeed.coinType)

  const existingAcceptedCurrency = await findAcceptedCurrencyByCoinType({
    coinType,
    shopId: shopIdentifiers.shopId,
    suiClient
  })

  if (existingAcceptedCurrency) {
    await logExistingAcceptedCurrency({
      coinType,
      existingAcceptedCurrency,
      shopId: shopIdentifiers.shopId,
      suiClient
    })
    return
  }

  const inputs = await normalizeAcceptedCurrencyInputs({
    currencySeed,
    cliArguments,
    shopIdentifiers,
    tooling
  })

  const shopSharedObject = await tooling.getMutableSharedObject({
    objectId: inputs.shopId
  })
  const currencySharedObject = await tooling.getImmutableSharedObject({
    objectId: inputs.currencyId
  })
  const priceInfoSharedObject = await tooling.getImmutableSharedObject({
    objectId: inputs.priceInfoObjectId
  })

  const gasBudget = tooling.network.gasBudget ?? DEFAULT_TX_GAS_BUDGET

  const {
    objectArtifacts: { created }
  } = await signAndExecuteWithRetry({
    tooling,
    buildTransaction: () =>
      buildAddAcceptedCurrencyTransaction({
        packageId: inputs.packageId,
        coinType: inputs.coinType,
        shop: shopSharedObject,
        currency: currencySharedObject,
        feedIdBytes: inputs.feedIdBytes,
        pythObjectId: inputs.priceInfoObjectId,
        priceInfoObject: priceInfoSharedObject,
        ownerCapId: inputs.ownerCapId,
        maxPriceAgeSecsCap: inputs.maxPriceAgeSecsCap,
        maxConfidenceRatioBpsCap: inputs.maxConfidenceRatioBpsCap,
        maxPriceStatusLagSecsCap: inputs.maxPriceStatusLagSecsCap,
        gasBudget
      })
  })

  const acceptedCurrencyId =
    findCreatedArtifactIdBySuffix(created, "::shop::AcceptedCurrency") ??
    (await requireAcceptedCurrencyId({
      shopId: inputs.shopId,
      coinType: inputs.coinType,
      suiClient
    }))

  const acceptedCurrencySummary = await getAcceptedCurrencySummary(
    inputs.shopId,
    acceptedCurrencyId,
    suiClient
  )

  logAcceptedCurrencySummary(acceptedCurrencySummary)
  logKeyValueGreen("Feed-id")(currencySeed.feedId)
}

const normalizeAcceptedCurrencyInputs = async ({
  currencySeed,
  cliArguments,
  shopIdentifiers,
  tooling
}: {
  currencySeed: AcceptedCurrencySeed
  cliArguments: ShopSeedArguments
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Pick<Tooling, "resolveCurrencyObjectId">
}) => {
  const coinType = normalizeCoinType(currencySeed.coinType)
  const feedIdBytes = assertBytesLength(hexToBytes(currencySeed.feedId), 32)
  const normalizedPriceInfoObjectId = normalizeSuiObjectId(
    currencySeed.priceInfoObjectId
  )

  const currencyId =
    currencySeed.currencyId ||
    (await tooling.resolveCurrencyObjectId({
      coinType,
      registryId: SUI_COIN_REGISTRY_ID,
      fallbackRegistryScan: true
    }))

  if (!currencyId)
    throw new Error(
      `Could not resolve currency registry entry for ${coinType}. Ensure the coin is registered in the registry.`
    )

  return {
    packageId: shopIdentifiers.packageId,
    shopId: shopIdentifiers.shopId,
    ownerCapId: shopIdentifiers.ownerCapId,
    coinType,
    currencyId: normalizeSuiObjectId(currencyId),
    feedIdBytes,
    priceInfoObjectId: normalizedPriceInfoObjectId,
    maxPriceAgeSecsCap: parseOptionalPositiveU64(
      cliArguments.maxPriceAgeSecsCap,
      "maxPriceAgeSecsCap"
    ),
    maxConfidenceRatioBpsCap: parseOptionalPositiveU64(
      cliArguments.maxConfidenceRatioBpsCap,
      "maxConfidenceRatioBpsCap"
    ),
    maxPriceStatusLagSecsCap: parseOptionalPositiveU64(
      cliArguments.maxPriceStatusLagSecsCap,
      "maxPriceStatusLagSecsCap"
    )
  }
}

const logExistingAcceptedCurrency = async ({
  coinType,
  existingAcceptedCurrency,
  shopId,
  suiClient
}: {
  coinType: string
  existingAcceptedCurrency: AcceptedCurrencyMatch
  shopId: string
  suiClient: SuiClient
}) => {
  const acceptedCurrencyId =
    existingAcceptedCurrency.acceptedCurrencyId ||
    (await requireAcceptedCurrencyId({
      shopId,
      coinType,
      suiClient
    }))

  logKeyValueYellow("Currency")(`${coinType} already registered; skipping.`)

  const acceptedCurrencySummary = await getAcceptedCurrencySummary(
    shopId,
    acceptedCurrencyId,
    suiClient
  )

  logAcceptedCurrencySummary(acceptedCurrencySummary)
}

const ensureItemListings = async ({
  listingSeeds,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  listingSeeds: ItemListingSeed[]
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Tooling
  suiClient: SuiClient
}): Promise<ItemListingSummary[]> => {
  const existingListings = await getItemListingSummaries(
    shopIdentifiers.shopId,
    suiClient
  )
  const existingListingIndex = indexListingSummaries(existingListings)

  const shopSharedObject = await tooling.getMutableSharedObject({
    objectId: shopIdentifiers.shopId
  })

  return runSequentially(listingSeeds, (listing) =>
    ensureItemListing({
      listing,
      existingListingIndex,
      shopIdentifiers,
      shopSharedObject,
      tooling,
      suiClient
    })
  )
}

const ensureItemListing = async ({
  listing,
  existingListingIndex,
  shopIdentifiers,
  shopSharedObject,
  tooling,
  suiClient
}: {
  listing: ItemListingSeed
  existingListingIndex: Map<string, ItemListingSummary>
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  shopSharedObject: Awaited<ReturnType<Tooling["getSuiSharedObject"]>>
  tooling: Tooling
  suiClient: SuiClient
}): Promise<ItemListingSummary> => {
  const listingKey = buildListingKey(listing)
  const existingListing = listingKey
    ? existingListingIndex.get(listingKey)
    : undefined

  if (existingListing) {
    logKeyValueYellow("Listing")(`Using existing ${listing.name}.`)
    logItemListingSummary(existingListing)
    return existingListing
  }

  const { transactionResult } = await signAndExecuteWithRetry({
    tooling,
    buildTransaction: () =>
      buildAddItemListingTransaction({
        packageId: shopIdentifiers.packageId,
        itemType: listing.itemType,
        shop: shopSharedObject,
        ownerCapId: shopIdentifiers.ownerCapId,
        itemName: listing.name,
        basePriceUsdCents: parseUsdToCents(listing.priceUsd),
        stock: parsePositiveU64(listing.stock, "stock"),
        spotlightDiscountId: undefined
      })
  })

  const createdListingChange = ensureCreatedObject(
    "::shop::ItemListing",
    transactionResult
  )

  const listingId = normalizeIdOrThrow(
    createdListingChange.objectId,
    "Expected an ItemListing to be created."
  )
  const listingSummary = await getItemListingSummary(
    shopIdentifiers.shopId,
    listingId,
    suiClient
  )

  logItemListingSummary(listingSummary)
  return listingSummary
}

const ensureDiscountTemplates = async ({
  discountSeeds,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  discountSeeds: DiscountSeedDefinition[]
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Tooling
  suiClient: SuiClient
}): Promise<DiscountTemplateMap> => {
  const existingTemplates = await getDiscountTemplateSummaries(
    shopIdentifiers.shopId,
    suiClient
  )
  const existingTemplateIndex =
    indexDiscountTemplateSummaries(existingTemplates)

  const shopSharedObject = await tooling.getMutableSharedObject({
    objectId: shopIdentifiers.shopId
  })

  const initialTemplates: DiscountTemplateMap = {
    fixed: undefined,
    percent: undefined
  }

  return discountSeeds.reduce(
    async (pendingTemplates, seed) =>
      ensureDiscountTemplate({
        seed,
        existingTemplateIndex,
        currentTemplates: await pendingTemplates,
        shopIdentifiers,
        shopSharedObject,
        tooling,
        suiClient
      }),
    Promise.resolve(initialTemplates)
  )
}

const ensureDiscountTemplate = async ({
  seed,
  existingTemplateIndex,
  currentTemplates,
  shopIdentifiers,
  shopSharedObject,
  tooling,
  suiClient
}: {
  seed: DiscountSeedDefinition
  existingTemplateIndex: Map<string, DiscountTemplateEntry>
  currentTemplates: DiscountTemplateMap
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  shopSharedObject: Awaited<ReturnType<Tooling["getSuiSharedObject"]>>
  tooling: Tooling
  suiClient: SuiClient
}): Promise<DiscountTemplateMap> => {
  const normalizedRuleKind = parseDiscountRuleKind(seed.ruleKind)
  const ruleValue = parseDiscountRuleValue(normalizedRuleKind, seed.value)
  const ruleValueKey = ruleValue.toString()
  const templateKey = buildDiscountTemplateKey({
    ruleKind: seed.ruleKind,
    ruleValue: ruleValueKey,
    appliesToListingId: undefined
  })

  const existingTemplate = existingTemplateIndex.get(templateKey)

  if (existingTemplate) {
    logKeyValueYellow("Discount")(`Using existing ${seed.ruleKind} template.`)
    logDiscountTemplateSummary(existingTemplate)
    return {
      ...currentTemplates,
      [seed.ruleKind]: {
        discountTemplateId: existingTemplate.discountTemplateId
      }
    }
  }

  const startsAt = parseNonNegativeU64(
    defaultStartTimestampSeconds().toString(),
    "startsAt"
  )
  const expiresAt = undefined
  const maxRedemptions = parseOptionalU64(seed.maxRedemptions, "maxRedemptions")

  validateDiscountSchedule(startsAt, expiresAt)

  const {
    objectArtifacts: { created: createdObjects }
  } = await signAndExecuteWithRetry({
    tooling,
    buildTransaction: () =>
      buildCreateDiscountTemplateTransaction({
        packageId: shopIdentifiers.packageId,
        shop: shopSharedObject,
        appliesToListingId: undefined,
        ruleKind: normalizedRuleKind,
        ruleValue,
        startsAt,
        expiresAt,
        maxRedemptions,
        ownerCapId: shopIdentifiers.ownerCapId
      })
  })

  const createdTemplateId = requireCreatedArtifactIdBySuffix({
    createdArtifacts: createdObjects,
    suffix: DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
    label: "DiscountTemplate"
  })

  const discountTemplateSummary = await getDiscountTemplateSummary(
    shopIdentifiers.shopId,
    createdTemplateId,
    suiClient
  )

  logDiscountTemplateSummary(discountTemplateSummary)
  return {
    ...currentTemplates,
    [seed.ruleKind]: {
      discountTemplateId: createdTemplateId
    }
  }
}

const ensureFixedDiscountSpotlight = async ({
  fixedTemplateSummary,
  preferredListingName,
  itemListingSummaries,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  fixedTemplateSummary?: { discountTemplateId: string }
  preferredListingName: string
  itemListingSummaries: ItemListingSummary[]
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  tooling: Tooling
  suiClient: SuiClient
}) => {
  if (!fixedTemplateSummary) return

  const listing =
    itemListingSummaries.find(
      (summary) => summary.name === preferredListingName
    ) ?? itemListingSummaries[0]

  if (!listing) return

  if (listing.spotlightTemplateId === fixedTemplateSummary.discountTemplateId) {
    logKeyValueYellow("Spotlight")("Fixed discount already attached.")
    return
  }
  if (
    listing.spotlightTemplateId &&
    listing.spotlightTemplateId !== fixedTemplateSummary.discountTemplateId
  ) {
    logKeyValueYellow("Spotlight")(
      "Listing already has a spotlight discount; skipping attach."
    )
    return
  }

  const resolvedIds = await validateTemplateAndListing({
    shopId: shopIdentifiers.shopId,
    itemListingId: listing.itemListingId,
    discountTemplateId: fixedTemplateSummary.discountTemplateId,
    suiClient
  })

  const shopSharedObject = await tooling.getImmutableSharedObject({
    objectId: shopIdentifiers.shopId
  })
  const itemListingSharedObject = await tooling.getMutableSharedObject({
    objectId: resolvedIds.itemListingId
  })
  const discountTemplateSharedObject = await tooling.getImmutableSharedObject({
    objectId: resolvedIds.discountTemplateId
  })

  await signAndExecuteWithRetry({
    tooling,
    buildTransaction: () =>
      buildAttachDiscountTemplateTransaction({
        packageId: shopIdentifiers.packageId,
        shop: shopSharedObject,
        itemListing: itemListingSharedObject,
        discountTemplate: discountTemplateSharedObject,
        ownerCapId: shopIdentifiers.ownerCapId
      })
  })

  const [listingSummary, discountTemplateSummary] = await Promise.all([
    getItemListingSummary(
      shopIdentifiers.shopId,
      resolvedIds.itemListingId,
      suiClient
    ),
    getDiscountTemplateSummary(
      shopIdentifiers.shopId,
      resolvedIds.discountTemplateId,
      suiClient
    )
  ])

  logItemListingSummary(listingSummary)
  logDiscountTemplateSummary(discountTemplateSummary)
}

const buildListingKey = (listing: ItemListingSeed) => {
  const normalizedName = listing.name.trim().toLowerCase()
  if (!normalizedName) return undefined
  return `${normalizedName}::${listing.itemType}`
}

const indexListingSummaries = (summaries: ItemListingSummary[]) =>
  summaries.reduce<Map<string, ItemListingSummary>>((index, summary) => {
    if (!summary.name) return index
    const key = `${summary.name.trim().toLowerCase()}::${summary.itemType}`
    index.set(key, summary)
    return index
  }, new Map())

const buildDiscountTemplateKey = ({
  ruleKind,
  ruleValue,
  appliesToListingId
}: {
  ruleKind: DiscountRuleKindLabel
  ruleValue: string
  appliesToListingId?: string
}) => `${ruleKind}:${ruleValue}:${appliesToListingId ?? "global"}`

const indexDiscountTemplateSummaries = (
  summaries: Awaited<ReturnType<typeof getDiscountTemplateSummaries>>
) =>
  summaries.reduce<Map<string, (typeof summaries)[number]>>(
    (index, summary) => {
      if (!summary.ruleValue) return index
      if (summary.ruleKind !== "fixed" && summary.ruleKind !== "percent")
        return index
      const key = buildDiscountTemplateKey({
        ruleKind: summary.ruleKind,
        ruleValue: summary.ruleValue,
        appliesToListingId: summary.appliesToListingId
      })
      index.set(key, summary)
      return index
    },
    new Map()
  )

const requireAcceptedCurrencyId = async ({
  shopId,
  coinType,
  suiClient
}: {
  shopId: string
  coinType: string
  suiClient: SuiClient
}): Promise<string> => {
  const match = await requireAcceptedCurrencyByCoinType({
    coinType,
    shopId,
    suiClient
  })
  return match.acceptedCurrencyId
}
