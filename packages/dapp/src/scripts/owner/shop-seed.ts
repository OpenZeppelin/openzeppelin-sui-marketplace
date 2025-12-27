/**
 * Seeds a shop with accepted USDC and WAL currencies, example listings, and discounts.
 * Intended for testnet setup after publishing the Move packages.
 */
import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  findAcceptedCurrencyByCoinType,
  getAcceptedCurrencySummary,
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
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import {
  getItemListingSummaries,
  getItemListingSummary,
  type ItemListingSummary
} from "@sui-oracle-market/domain-core/models/item-listing"
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
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { resolveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import {
  assertBytesLength,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import {
  parseNonNegativeU64,
  parseOptionalPositiveU64,
  parseOptionalU64,
  parsePositiveU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { ensureCreatedObject } from "@sui-oracle-market/tooling-node/transactions"
import {
  logAcceptedCurrencySummary,
  logDiscountTemplateSummary,
  logItemListingSummary,
  logShopOverview
} from "../../utils/log-summaries.ts"
import {
  resolveItemExamplesPackageId,
  resolveShopPublishInputs
} from "../../utils/publish-artifacts.ts"

const DEFAULT_USDC_COIN_TYPE =
  "0xea10912247c015ead590e481ae8545ff1518492dee41d6d03abdad828c1d2bde::usdc::USDC"
// Pyth feed config for USDC on testnet.
const DEFAULT_USDC_FEED_ID =
  "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722"
// Pyth price info object id for the USDC coin on testnet.
const DEFAULT_USDC_PRICE_INFO_OBJECT_ID =
  "0x9c4dd4008297ffa5e480684b8100ec21cc934405ed9a25d4e4d7b6259aad9c81"
const DEFAULT_WAL_COIN_TYPE =
  "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL"
// Pyth feed config for WAL (Walrus Protocol) on testnet.
const DEFAULT_WAL_FEED_ID =
  "0xa6ba0195b5364be116059e401fb71484ed3400d4d9bfbdf46bd11eab4f9b7cea"
const DEFAULT_WAL_PRICE_INFO_OBJECT_ID =
  "0x52e5fb291bd86ca8bdd3e6d89ef61d860ea02e009a64bcc287bc703907ff3e8a"
const DEFAULT_ITEM_MODULE = "items"

type ShopSeedArguments = {
  shopPackageId?: string
  publisherCapId?: string
  shopId?: string
  ownerCapId?: string
  itemPackageId?: string
  coinType?: string
  currencyId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
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

type AcceptedCurrencySeed = {
  coinType: string
  feedId: string
  priceInfoObjectId: string
}

const ACCEPTED_CURRENCY_SEEDS: AcceptedCurrencySeed[] = [
  {
    coinType: DEFAULT_USDC_COIN_TYPE,
    feedId: DEFAULT_USDC_FEED_ID,
    priceInfoObjectId: DEFAULT_USDC_PRICE_INFO_OBJECT_ID
  },
  {
    coinType: DEFAULT_WAL_COIN_TYPE,
    feedId: DEFAULT_WAL_FEED_ID,
    priceInfoObjectId: DEFAULT_WAL_PRICE_INFO_OBJECT_ID
  }
]

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

    const itemPackageId = await resolveItemExamplesPackageId({
      networkName,
      itemPackageId: cliArguments.itemPackageId
    })
    const listingSeeds = buildItemListingSeeds(itemPackageId)

    const acceptedCurrencySeeds = resolveAcceptedCurrencySeeds(cliArguments)
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
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest publish entry when omitted."
    })
    .option("publisherCapId", {
      alias: ["publisher-cap-id", "publisher-id"],
      type: "string",
      description:
        "0x2::package::Publisher object ID; inferred from the latest publish entry when omitted."
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
    .option("coinType", {
      alias: ["coin-type", "type"],
      type: "string",
      description:
        "Optional coin type filter (USDC or WAL). When provided, only that currency is seeded."
    })
    .option("currencyId", {
      alias: ["currency-object-id", "currency"],
      type: "string",
      description:
        "Currency<T> object ID in the coin registry. Requires --coin-type when provided."
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
}) => {
  const hasExplicitShopInputs =
    Boolean(cliArguments.shopId) || Boolean(cliArguments.ownerCapId)

  const existingIdentifiers = await resolveExistingShopIdentifiers({
    cliArguments,
    networkName,
    allowMissing: !hasExplicitShopInputs
  })
  if (existingIdentifiers) return existingIdentifiers

  const { shopPackageId, publisherCapId } = await resolveShopPublishInputs({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    publisherCapId: cliArguments.publisherCapId
  })

  logKeyValueBlue("Shop")("Creating shop from published package.")

  const createShopTransaction = buildCreateShopTransaction({
    packageId: shopPackageId,
    publisherCapId
  })

  const {
    objectArtifacts: { created }
  } = await tooling.signAndExecute({
    transaction: createShopTransaction,
    signer: tooling.loadedEd25519KeyPair
  })

  const shopId = requireCreatedObjectId(created, "::shop::Shop", "Shop")
  const ownerCapId = requireCreatedObjectId(
    created,
    "::shop::ShopOwnerCap",
    "ShopOwnerCap"
  )

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
    return await resolveLatestShopIdentifiers(
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

const resolveAcceptedCurrencySeeds = (
  cliArguments: ShopSeedArguments
): AcceptedCurrencySeed[] => {
  if (!cliArguments.coinType) return ACCEPTED_CURRENCY_SEEDS

  const normalizedCoinType = normalizeCoinType(cliArguments.coinType)
  const matchedSeed = ACCEPTED_CURRENCY_SEEDS.find(
    (seed) => normalizeCoinType(seed.coinType) === normalizedCoinType
  )

  if (!matchedSeed)
    throw new Error(
      `Unsupported coin type ${normalizedCoinType}. Supported coins: ${ACCEPTED_CURRENCY_SEEDS.map((seed) => seed.coinType).join(", ")}.`
    )

  return [matchedSeed]
}

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
  if (cliArguments.currencyId && acceptedCurrencySeeds.length !== 1)
    throw new Error(
      "currencyId overrides require --coin-type to target a single currency."
    )

  for (const currencySeed of acceptedCurrencySeeds) {
    await ensureAcceptedCurrency({
      currencySeed,
      currencyIdOverride: cliArguments.currencyId,
      cliArguments,
      shopIdentifiers,
      tooling,
      suiClient
    })
  }
}

const ensureAcceptedCurrency = async ({
  currencySeed,
  currencyIdOverride,
  cliArguments,
  shopIdentifiers,
  tooling,
  suiClient
}: {
  currencySeed: AcceptedCurrencySeed
  currencyIdOverride?: string
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
    currencyIdOverride,
    cliArguments,
    shopIdentifiers,
    suiClient
  })

  const shopSharedObject = await tooling.getSuiSharedObject({
    objectId: inputs.shopId,
    mutable: true
  })
  const currencySharedObject = await tooling.getSuiSharedObject({
    objectId: inputs.currencyId,
    mutable: false
  })
  const priceInfoSharedObject = await tooling.getSuiSharedObject({
    objectId: inputs.priceInfoObjectId,
    mutable: false
  })

  const addCurrencyTransaction = buildAddAcceptedCurrencyTransaction({
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
    maxPriceStatusLagSecsCap: inputs.maxPriceStatusLagSecsCap
  })

  const {
    objectArtifacts: { created }
  } = await tooling.signAndExecute({
    transaction: addCurrencyTransaction,
    signer: tooling.loadedEd25519KeyPair
  })

  const acceptedCurrencyId =
    findCreatedObjectId(created, "::shop::AcceptedCurrency") ??
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
  currencyIdOverride,
  cliArguments,
  shopIdentifiers,
  suiClient
}: {
  currencySeed: AcceptedCurrencySeed
  currencyIdOverride?: string
  cliArguments: ShopSeedArguments
  shopIdentifiers: { packageId: string; shopId: string; ownerCapId: string }
  suiClient: SuiClient
}) => {
  const coinType = normalizeCoinType(currencySeed.coinType)
  const feedIdBytes = assertBytesLength(
    hexToBytes(currencySeed.feedId),
    32
  )
  const normalizedPriceInfoObjectId = normalizeSuiObjectId(
    currencySeed.priceInfoObjectId
  )

  const currencyId =
    currencyIdOverride ||
    (await resolveCurrencyObjectId(
      {
        coinType,
        registryId: SUI_COIN_REGISTRY_ID,
        fallbackRegistryScan: true
      },
      { suiClient }
    ))

  if (!currencyId)
    throw new Error(
      `Could not resolve currency registry entry for ${coinType}. Provide --currency-id or register the coin first.`
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

  const shopSharedObject = await tooling.getSuiSharedObject({
    objectId: shopIdentifiers.shopId,
    mutable: true
  })

  const ensuredListings: ItemListingSummary[] = []

  for (const listing of listingSeeds) {
    const listingKey = buildListingKey(listing)
    const existingListing = listingKey
      ? existingListingIndex.get(listingKey)
      : undefined

    if (existingListing) {
      logKeyValueYellow("Listing")(`Using existing ${listing.name}.`)
      logItemListingSummary(existingListing)
      ensuredListings.push(existingListing)
      continue
    }

    const addItemTransaction = buildAddItemListingTransaction({
      packageId: shopIdentifiers.packageId,
      itemType: listing.itemType,
      shop: shopSharedObject,
      ownerCapId: shopIdentifiers.ownerCapId,
      itemName: listing.name,
      basePriceUsdCents: parseUsdToCents(listing.priceUsd),
      stock: parsePositiveU64(listing.stock, "stock"),
      spotlightDiscountId: undefined
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: addItemTransaction,
      signer: tooling.loadedEd25519KeyPair
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
    ensuredListings.push(listingSummary)
  }

  return ensuredListings
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
}): Promise<
  Record<"fixed" | "percent", { discountTemplateId: string } | undefined>
> => {
  const existingTemplates = await getDiscountTemplateSummaries(
    shopIdentifiers.shopId,
    suiClient
  )
  const existingTemplateIndex =
    indexDiscountTemplateSummaries(existingTemplates)

  const shopSharedObject = await tooling.getSuiSharedObject({
    objectId: shopIdentifiers.shopId,
    mutable: true
  })

  const ensuredTemplates: Record<
    "fixed" | "percent",
    { discountTemplateId: string } | undefined
  > = {
    fixed: undefined,
    percent: undefined
  }

  for (const seed of discountSeeds) {
    const normalizedRuleKind = parseDiscountRuleKind(seed.ruleKind)
    const ruleValue = parseDiscountRuleValue(normalizedRuleKind, seed.value)
    const ruleValueKey = ruleValue.toString()
    const templateKey = buildDiscountTemplateKey({
      ruleKind: seed.ruleKind,
      ruleValue: ruleValueKey,
      appliesToListingId: undefined
    })

    const existingTemplate = templateKey
      ? existingTemplateIndex.get(templateKey)
      : undefined

    if (existingTemplate) {
      logKeyValueYellow("Discount")(`Using existing ${seed.ruleKind} template.`)
      logDiscountTemplateSummary(existingTemplate)
      ensuredTemplates[seed.ruleKind] = {
        discountTemplateId: existingTemplate.discountTemplateId
      }
      continue
    }

    const startsAt = parseNonNegativeU64(
      defaultStartTimestampSeconds().toString(),
      "startsAt"
    )
    const expiresAt = undefined
    const maxRedemptions = parseOptionalU64(
      seed.maxRedemptions,
      "maxRedemptions"
    )

    validateDiscountSchedule(startsAt, expiresAt)

    const createDiscountTemplateTransaction =
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

    const {
      objectArtifacts: { created: createdObjects }
    } = await tooling.signAndExecute({
      transaction: createDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const createdTemplateId = requireCreatedObjectId(
      createdObjects,
      DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
      "DiscountTemplate"
    )

    const discountTemplateSummary = await getDiscountTemplateSummary(
      shopIdentifiers.shopId,
      createdTemplateId,
      suiClient
    )

    logDiscountTemplateSummary(discountTemplateSummary)
    ensuredTemplates[seed.ruleKind] = {
      discountTemplateId: createdTemplateId
    }
  }

  return ensuredTemplates
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

  const shopSharedObject = await tooling.getSuiSharedObject({
    objectId: shopIdentifiers.shopId,
    mutable: false
  })
  const itemListingSharedObject = await tooling.getSuiSharedObject({
    objectId: resolvedIds.itemListingId,
    mutable: true
  })
  const discountTemplateSharedObject = await tooling.getSuiSharedObject({
    objectId: resolvedIds.discountTemplateId,
    mutable: false
  })

  const attachDiscountTemplateTransaction =
    buildAttachDiscountTemplateTransaction({
      packageId: shopIdentifiers.packageId,
      shop: shopSharedObject,
      itemListing: itemListingSharedObject,
      discountTemplate: discountTemplateSharedObject,
      ownerCapId: shopIdentifiers.ownerCapId
    })

  await tooling.signAndExecute({
    transaction: attachDiscountTemplateTransaction,
    signer: tooling.loadedEd25519KeyPair
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

const findCreatedObjectId = (
  createdArtifacts: ObjectArtifact[] | undefined,
  suffix: string
) =>
  createdArtifacts?.find((artifact) => artifact.objectType?.endsWith(suffix))
    ?.objectId

const requireCreatedObjectId = (
  createdArtifacts: ObjectArtifact[] | undefined,
  suffix: string,
  label: string
) =>
  normalizeIdOrThrow(
    findCreatedObjectId(createdArtifacts, suffix),
    `Expected ${label} to be created, but it was not found in transaction artifacts.`
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
