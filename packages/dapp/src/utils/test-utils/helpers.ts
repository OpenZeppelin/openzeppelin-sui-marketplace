import { readFile } from "node:fs/promises"
import path from "node:path"

import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { resolvePythPackageIdFromShopModule } from "@sui-oracle-market/domain-node/shop"
import { findDependencyPackageIdByModuleName } from "@sui-oracle-market/tooling-core/package"
import {
  findPublishedPackageIdByName,
  pickRootNonDependencyArtifact
} from "@sui-oracle-market/tooling-node/package"
import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"
import type {
  TestAccount,
  TestContext
} from "@sui-oracle-market/tooling-node/testing/localnet"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  type ScriptArgumentMap,
  type ScriptRunOptions,
  type ScriptRunResult,
  type SuiScriptRunner
} from "@sui-oracle-market/tooling-node/testing/scripts"

import type { MockArtifact } from "../mocks.ts"

export type ScriptJsonOptions = Omit<ScriptRunOptions, "args"> & {
  args?: ScriptArgumentMap
}

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

export const createDappIntegrationTestEnv = () =>
  createSuiLocalnetTestEnv({
    mode: "test",
    keepTemp: resolveKeepTemp(),
    withFaucet: resolveWithFaucet()
  })

export const createScriptRunner = (context: TestContext) =>
  createSuiScriptRunner(context)

export const publishMovePackage = async (
  context: TestContext,
  publisher: TestAccount,
  packagePath: string
) => {
  const artifacts = await context.publishPackage(packagePath, publisher, {
    withUnpublishedDependencies: true
  })
  return pickRootNonDependencyArtifact(artifacts)
}

const withJsonOutput = (args?: ScriptArgumentMap): ScriptArgumentMap => ({
  ...args,
  json: true
})

export const runScriptJson = async <T>(
  runScript: (
    scriptName: string,
    options?: ScriptRunOptions
  ) => Promise<ScriptRunResult>,
  scriptName: string,
  options: ScriptJsonOptions
): Promise<T> => {
  const result = await runScript(scriptName, {
    ...options,
    args: withJsonOutput(options.args)
  })

  return parseJsonFromScriptOutput<T>(result.stdout, `${scriptName} output`)
}

export const runOwnerScriptJson = async <T>(
  scriptRunner: SuiScriptRunner,
  scriptName: string,
  options: ScriptJsonOptions
): Promise<T> =>
  runScriptJson(
    (nextScriptName, runOptions) =>
      scriptRunner.runOwnerScript(nextScriptName, runOptions),
    scriptName,
    options
  )

export const runBuyerScriptJson = async <T>(
  scriptRunner: SuiScriptRunner,
  scriptName: string,
  options: ScriptJsonOptions
): Promise<T> =>
  runScriptJson(
    (nextScriptName, runOptions) =>
      scriptRunner.runBuyerScript(nextScriptName, runOptions),
    scriptName,
    options
  )

type FundingOptions = Parameters<TestContext["fundAccount"]>[1]

export type FundedAccountOptions = {
  label?: string
  funding?: FundingOptions
}

export type ShopCreateOutput = {
  shopOverview?: {
    shopId?: string
    ownerAddress?: string
    name?: string
  }
  transactionSummary?: {
    status?: string
  }
}

export type ShopFixture = {
  publisher: TestAccount
  scriptRunner: SuiScriptRunner
  shopPackageId: string
  pythPackageId?: string
  shopId: string
  shopName: string
  shopCreateOutput: ShopCreateOutput
}

export type ShopFixtureOptions = {
  shopName?: string
  publisherLabel?: string
  funding?: FundingOptions
  publisher?: TestAccount
  scriptRunner?: SuiScriptRunner
}

export type ShopWithItemExamplesFixture = ShopFixture & {
  itemExamplesPackageId: string
}

export type ItemListingFixture = {
  itemListingId: string
  itemType: string
  name: string
}

export type DiscountTemplateFixture = {
  discountTemplateId: string
  ruleKind: string
  value: string
}

export type ShopSeedFixture = {
  itemListing: ItemListingFixture
  discountTemplate: DiscountTemplateFixture
}

export type CurrencyAddScriptOutput = {
  status?: string
  coinType?: string
  acceptedCurrency?: Partial<AcceptedCurrencySummary> & {
    acceptedCurrencyFieldId?: string
    typeIndexFieldId?: string
  }
  transactionSummary?: {
    status?: string
  }
}

type MockPriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]
type MockCoinArtifact = NonNullable<MockArtifact["coins"]>[number]

export type MockCurrencyFeedSelection = {
  coinType: string
  currencyObjectId: string
  feedIdHex: string
  priceInfoObjectId: string
}

export type AcceptedCurrencyFixture = MockCurrencyFeedSelection & {
  acceptedCurrencyId: string
  currencyAddOutput: CurrencyAddScriptOutput
}

export type ShopWithMockSetupFixture = ShopFixture & {
  mockArtifact: MockArtifact
}

export type ShopWithItemExamplesAndMockSetupFixture =
  ShopWithItemExamplesFixture & {
    mockArtifact: MockArtifact
  }

export type ShopWithAcceptedCurrencyFixture = ShopWithMockSetupFixture & {
  acceptedCurrency: AcceptedCurrencyFixture
}

export type ShopWithItemExamplesAndAcceptedCurrencyFixture =
  ShopWithItemExamplesAndMockSetupFixture & {
    acceptedCurrency: AcceptedCurrencyFixture
  }

export type ShopWithMockSetupFixtureOptions = ShopFixtureOptions & {
  pythPackageId?: string
  buyerAddress?: string
  itemPackageId?: string
}

export type AcceptedCurrencyFixtureOptions = ShopWithMockSetupFixtureOptions & {
  preferredCoinType?: string
  preferredCoinLabel?: string
}

const DEFAULT_FUNDING_OPTIONS: FundingOptions = {
  minimumCoinObjects: 2
}
const DEFAULT_MOCK_SETUP_FUNDING_OPTIONS: FundingOptions = {
  minimumCoinObjects: 12,
  minimumBalance: 20_000_000_000n
}

const MOCK_SETUP_SCRIPT_PATH = path.join("src", "scripts", "mock", "setup.ts")
const MOCK_ARTIFACT_FILE_NAME = "mock.localnet.json"

const resolveShopName = (context: TestContext, name?: string) =>
  name ?? `Integration Shop ${context.testId}`

const requireDefined = <T>(value: T | null | undefined, message: string): T => {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
  return value
}

export const createFundedTestAccount = async (
  context: TestContext,
  options: FundedAccountOptions = {}
): Promise<TestAccount> => {
  const accountLabel = options.label ?? "publisher"
  const account = context.createAccount(accountLabel)
  await context.fundAccount(account, options.funding ?? DEFAULT_FUNDING_OPTIONS)
  return account
}

export const createShopFixture = async (
  context: TestContext,
  options: ShopFixtureOptions = {}
): Promise<ShopFixture> => {
  const publisher =
    options.publisher ??
    (await createFundedTestAccount(context, {
      label: options.publisherLabel,
      funding: options.funding
    }))
  if (options.publisher) {
    await context.fundAccount(
      publisher,
      options.funding ?? DEFAULT_FUNDING_OPTIONS
    )
  }
  const scriptRunner = options.scriptRunner ?? createScriptRunner(context)
  const oracleMarketPublishArtifacts = await context.publishPackage(
    "oracle-market",
    publisher,
    {
      withUnpublishedDependencies: true
    }
  )
  const oracleMarketArtifact = pickRootNonDependencyArtifact(
    oracleMarketPublishArtifacts
  )
  const pythPackageIdFromPublish = findPublishedPackageIdByName(
    oracleMarketPublishArtifacts,
    "pyth"
  )
  const pythPackageId =
    pythPackageIdFromPublish ??
    (await findDependencyPackageIdByModuleName({
      suiClient: context.suiClient,
      dependencyPackageIds: oracleMarketArtifact.dependencies ?? [],
      moduleName: "price_info"
    })) ??
    (await resolvePythPackageIdFromShopModule({
      shopPackageId: oracleMarketArtifact.packageId,
      suiClient: context.suiClient
    }))
  // Ensure publish gas usage doesn't leave the publisher below the 500M script budget.
  await context.fundAccount(
    publisher,
    options.funding ?? DEFAULT_FUNDING_OPTIONS
  )
  const shopName = resolveShopName(context, options.shopName)
  const shopCreateOutput = await runOwnerScriptJson<ShopCreateOutput>(
    scriptRunner,
    "shop-create",
    {
      account: publisher,
      args: {
        shopPackageId: oracleMarketArtifact.packageId,
        name: shopName
      }
    }
  )
  const shopId = requireDefined(
    shopCreateOutput.shopOverview?.shopId,
    "shop-create did not return a shopId."
  )

  return {
    publisher,
    scriptRunner,
    shopPackageId: oracleMarketArtifact.packageId,
    pythPackageId,
    shopId,
    shopName,
    shopCreateOutput
  }
}

export const createShopWithItemExamplesFixture = async (
  context: TestContext,
  options: ShopFixtureOptions = {}
): Promise<ShopWithItemExamplesFixture> => {
  const shopFixture = await createShopFixture(context, options)
  const itemExamplesArtifact = await publishMovePackage(
    context,
    shopFixture.publisher,
    "item-examples"
  )

  return {
    ...shopFixture,
    itemExamplesPackageId: itemExamplesArtifact.packageId
  }
}

const resolveMockSetupPythPackageId = ({
  shopPackageId,
  resolvedPythPackageId,
  overridePythPackageId
}: {
  shopPackageId: string
  resolvedPythPackageId?: string
  overridePythPackageId?: string
}) =>
  requireDefined(
    overridePythPackageId ?? resolvedPythPackageId,
    `Unable to resolve Pyth package dependency for shop package ${shopPackageId}.`
  )

export const createShopWithMockSetupFixture = async (
  context: TestContext,
  options: ShopWithMockSetupFixtureOptions = {}
): Promise<ShopWithMockSetupFixture> => {
  const shopFixture = await createShopFixture(context, options)
  const pythPackageId = resolveMockSetupPythPackageId({
    shopPackageId: shopFixture.shopPackageId,
    resolvedPythPackageId: shopFixture.pythPackageId,
    overridePythPackageId: options.pythPackageId
  })
  const mockArtifact = await runMockSetupFixture({
    context,
    scriptRunner: shopFixture.scriptRunner,
    publisher: shopFixture.publisher,
    buyerAddress: options.buyerAddress,
    pythPackageId,
    itemPackageId: options.itemPackageId
  })

  return {
    ...shopFixture,
    pythPackageId,
    mockArtifact
  }
}

export const createShopWithItemExamplesAndMockSetupFixture = async (
  context: TestContext,
  options: ShopWithMockSetupFixtureOptions = {}
): Promise<ShopWithItemExamplesAndMockSetupFixture> => {
  const shopWithItemExamplesFixture = await createShopWithItemExamplesFixture(
    context,
    options
  )
  const pythPackageId = resolveMockSetupPythPackageId({
    shopPackageId: shopWithItemExamplesFixture.shopPackageId,
    resolvedPythPackageId: shopWithItemExamplesFixture.pythPackageId,
    overridePythPackageId: options.pythPackageId
  })
  const mockArtifact = await runMockSetupFixture({
    context,
    scriptRunner: shopWithItemExamplesFixture.scriptRunner,
    publisher: shopWithItemExamplesFixture.publisher,
    buyerAddress: options.buyerAddress,
    pythPackageId,
    itemPackageId:
      options.itemPackageId ?? shopWithItemExamplesFixture.itemExamplesPackageId
  })

  return {
    ...shopWithItemExamplesFixture,
    pythPackageId,
    mockArtifact
  }
}

export const resolveItemType = (packageId: string, itemTypeName: string) =>
  `${packageId}::items::${itemTypeName}`

export const createItemListingFixture = async ({
  scriptRunner,
  publisher,
  shopId,
  itemType,
  name = "Roadster",
  price = "1250",
  stock = "4"
}: {
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  shopId: string
  itemType: string
  name?: string
  price?: string
  stock?: string
}): Promise<ItemListingFixture> => {
  type ItemListingOutput = {
    itemListing?: {
      itemListingId?: string
      itemType?: string
      name?: string
    }
  }

  const listingOutput = await runOwnerScriptJson<ItemListingOutput>(
    scriptRunner,
    "item-listing-add",
    {
      account: publisher,
      args: {
        shopId,
        name,
        price,
        stock,
        itemType
      }
    }
  )

  const itemListingId = requireDefined(
    listingOutput.itemListing?.itemListingId,
    "item-listing-add did not return an itemListingId."
  )

  return {
    itemListingId,
    itemType: listingOutput.itemListing?.itemType ?? itemType,
    name: listingOutput.itemListing?.name ?? name
  }
}

export const createDiscountTemplateFixture = async ({
  scriptRunner,
  publisher,
  shopId,
  ruleKind = "percent",
  value = "10",
  listingId
}: {
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  shopId: string
  ruleKind?: string
  value?: string
  listingId?: string
}): Promise<DiscountTemplateFixture> => {
  type DiscountTemplateOutput = {
    discountTemplate?: {
      discountTemplateId?: string
    }
  }

  const discountOutput = await runOwnerScriptJson<DiscountTemplateOutput>(
    scriptRunner,
    "discount-template-create",
    {
      account: publisher,
      args: {
        shopId,
        ruleKind,
        value,
        listingId
      }
    }
  )

  const discountTemplateId = requireDefined(
    discountOutput.discountTemplate?.discountTemplateId,
    "discount-template-create did not return a discountTemplateId."
  )

  return {
    discountTemplateId,
    ruleKind,
    value
  }
}

export const attachDiscountTemplateToListing = async ({
  scriptRunner,
  publisher,
  shopId,
  itemListingId,
  discountTemplateId
}: {
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  shopId: string
  itemListingId: string
  discountTemplateId: string
}): Promise<void> => {
  await runOwnerScriptJson<Record<string, unknown>>(
    scriptRunner,
    "item-listing-attach-discount-template",
    {
      account: publisher,
      args: {
        shopId,
        itemListingId,
        discountTemplateId
      }
    }
  )
}

export const seedShopWithListingAndDiscount = async ({
  scriptRunner,
  publisher,
  shopId,
  itemType,
  listingName,
  price,
  stock,
  ruleKind,
  value
}: {
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  shopId: string
  itemType: string
  listingName?: string
  price?: string
  stock?: string
  ruleKind?: string
  value?: string
}): Promise<ShopSeedFixture> => {
  const itemListing = await createItemListingFixture({
    scriptRunner,
    publisher,
    shopId,
    itemType,
    name: listingName,
    price,
    stock
  })

  const discountTemplate = await createDiscountTemplateFixture({
    scriptRunner,
    publisher,
    shopId,
    ruleKind,
    value
  })

  await attachDiscountTemplateToListing({
    scriptRunner,
    publisher,
    shopId,
    itemListingId: itemListing.itemListingId,
    discountTemplateId: discountTemplate.discountTemplateId
  })

  return {
    itemListing,
    discountTemplate
  }
}

const resolveMockArtifactFilePath = (context: TestContext) =>
  path.join(context.artifactsDir, MOCK_ARTIFACT_FILE_NAME)

const normalizeHexLikeId = (value?: string) => value?.trim().toLowerCase()

const readMockArtifactForContext = async (
  context: TestContext
): Promise<MockArtifact> => {
  const mockArtifactFilePath = resolveMockArtifactFilePath(context)
  try {
    const mockArtifactRaw = await readFile(mockArtifactFilePath, "utf8")
    return JSON.parse(mockArtifactRaw) as MockArtifact
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Unable to read mock artifact at ${mockArtifactFilePath}: ${errorMessage}`
    )
  }
}

const resolveMockLabelKey = (label?: string): string | undefined => {
  const normalizedLabel = label?.trim().toLowerCase()
  if (!normalizedLabel) return undefined
  if (normalizedLabel.includes("usd")) return "usd"
  if (normalizedLabel.includes("btc")) return "btc"
  if (normalizedLabel.includes("sui")) return "sui"
  return normalizedLabel
}

const findPreferredMockCoin = ({
  coins,
  preferredCoinType,
  preferredLabelKey
}: {
  coins: MockCoinArtifact[]
  preferredCoinType?: string
  preferredLabelKey?: string
}): MockCoinArtifact => {
  const normalizedPreferredCoinType = preferredCoinType?.toLowerCase()
  const preferredCoinByType = normalizedPreferredCoinType
    ? coins.find(
        (coin) => coin.coinType.toLowerCase() === normalizedPreferredCoinType
      )
    : undefined

  if (preferredCoinByType) return preferredCoinByType

  const normalizedPreferredLabelKey = resolveMockLabelKey(preferredLabelKey)
  const preferredCoinByLabel = normalizedPreferredLabelKey
    ? coins.find(
        (coin) =>
          resolveMockLabelKey(coin.label) === normalizedPreferredLabelKey
      )
    : undefined

  return preferredCoinByLabel ?? coins[0]
}

const findFeedForCoin = ({
  coin,
  feeds
}: {
  coin: MockCoinArtifact
  feeds: MockPriceFeedArtifact[]
}): MockPriceFeedArtifact => {
  const coinLabelKey = resolveMockLabelKey(coin.label)
  if (!coinLabelKey) return feeds[0]

  const matchingFeed = feeds.find(
    (feed) => resolveMockLabelKey(feed.label) === coinLabelKey
  )

  return matchingFeed ?? feeds[0]
}

export const runMockSetupFixture = async ({
  context,
  scriptRunner,
  publisher,
  buyerAddress,
  pythPackageId,
  itemPackageId
}: {
  context: TestContext
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  buyerAddress?: string
  pythPackageId?: string
  itemPackageId?: string
}): Promise<MockArtifact> => {
  await context.fundAccount(publisher, DEFAULT_MOCK_SETUP_FUNDING_OPTIONS)

  await scriptRunner.runScript(MOCK_SETUP_SCRIPT_PATH, {
    account: publisher,
    args: {
      buyerAddress,
      pythPackageId,
      itemPackageId,
      useCliPublish: false
    }
  })

  return readMockArtifactForContext(context)
}

export const resolveMockCurrencyFeedSelection = ({
  mockArtifact,
  preferredCoinType,
  preferredCoinLabel
}: {
  mockArtifact: MockArtifact
  preferredCoinType?: string
  preferredCoinLabel?: string
}): MockCurrencyFeedSelection => {
  const availableCoins = mockArtifact.coins ?? []
  const availablePriceFeeds = mockArtifact.priceFeeds ?? []

  if (!availableCoins.length)
    throw new Error(
      "Mock artifact does not contain seeded coins. Run mock setup first."
    )
  if (!availablePriceFeeds.length)
    throw new Error(
      "Mock artifact does not contain seeded price feeds. Run mock setup first."
    )

  const selectedCoin = findPreferredMockCoin({
    coins: availableCoins,
    preferredCoinType,
    preferredLabelKey: preferredCoinLabel
  })
  const selectedFeed = findFeedForCoin({
    coin: selectedCoin,
    feeds: availablePriceFeeds
  })

  return {
    coinType: selectedCoin.coinType,
    currencyObjectId: selectedCoin.currencyObjectId,
    feedIdHex: selectedFeed.feedIdHex,
    priceInfoObjectId: selectedFeed.priceInfoObjectId
  }
}

export const createAcceptedCurrencyFixture = async ({
  context,
  scriptRunner,
  publisher,
  shopId,
  shopPackageId,
  pythPackageId,
  itemPackageId,
  mockArtifact,
  buyerAddress,
  preferredCoinType,
  preferredCoinLabel
}: {
  context: TestContext
  scriptRunner: SuiScriptRunner
  publisher: TestAccount
  shopId: string
  shopPackageId?: string
  pythPackageId?: string
  itemPackageId?: string
  mockArtifact?: MockArtifact
  buyerAddress?: string
  preferredCoinType?: string
  preferredCoinLabel?: string
}): Promise<AcceptedCurrencyFixture> => {
  const resolvedMockArtifact =
    mockArtifact ??
    (await runMockSetupFixture({
      context,
      scriptRunner,
      publisher,
      buyerAddress,
      pythPackageId,
      itemPackageId
    }))

  if (
    pythPackageId &&
    resolvedMockArtifact.pythPackageId &&
    normalizeHexLikeId(resolvedMockArtifact.pythPackageId) !==
      normalizeHexLikeId(pythPackageId)
  ) {
    throw new Error(
      `mock/setup reused unexpected pyth package id: expected ${pythPackageId}, received ${resolvedMockArtifact.pythPackageId}.`
    )
  }

  const selection = resolveMockCurrencyFeedSelection({
    mockArtifact: resolvedMockArtifact,
    preferredCoinType,
    preferredCoinLabel
  })

  const currencyAddOutput = await runOwnerScriptJson<CurrencyAddScriptOutput>(
    scriptRunner,
    "currency-add",
    {
      account: publisher,
      args: {
        shopId,
        shopPackageId,
        coinType: selection.coinType,
        feedId: selection.feedIdHex,
        priceInfoObjectId: selection.priceInfoObjectId
      }
    }
  )

  const acceptedCurrencyId = requireDefined(
    currencyAddOutput.acceptedCurrency?.acceptedCurrencyId,
    "currency-add did not return an acceptedCurrencyId."
  )

  return {
    ...selection,
    acceptedCurrencyId,
    currencyAddOutput
  }
}

export const createShopWithAcceptedCurrencyFixture = async (
  context: TestContext,
  options: AcceptedCurrencyFixtureOptions = {}
): Promise<ShopWithAcceptedCurrencyFixture> => {
  const shopWithMockSetupFixture = await createShopWithMockSetupFixture(
    context,
    options
  )
  const acceptedCurrency = await createAcceptedCurrencyFixture({
    context,
    scriptRunner: shopWithMockSetupFixture.scriptRunner,
    publisher: shopWithMockSetupFixture.publisher,
    shopId: shopWithMockSetupFixture.shopId,
    shopPackageId: shopWithMockSetupFixture.shopPackageId,
    pythPackageId: shopWithMockSetupFixture.pythPackageId,
    itemPackageId: options.itemPackageId,
    mockArtifact: shopWithMockSetupFixture.mockArtifact,
    preferredCoinType: options.preferredCoinType,
    preferredCoinLabel: options.preferredCoinLabel
  })

  return {
    ...shopWithMockSetupFixture,
    acceptedCurrency
  }
}

export const createShopWithItemExamplesAndAcceptedCurrencyFixture = async (
  context: TestContext,
  options: AcceptedCurrencyFixtureOptions = {}
): Promise<ShopWithItemExamplesAndAcceptedCurrencyFixture> => {
  const shopWithItemExamplesAndMockSetupFixture =
    await createShopWithItemExamplesAndMockSetupFixture(context, options)
  const acceptedCurrency = await createAcceptedCurrencyFixture({
    context,
    scriptRunner: shopWithItemExamplesAndMockSetupFixture.scriptRunner,
    publisher: shopWithItemExamplesAndMockSetupFixture.publisher,
    shopId: shopWithItemExamplesAndMockSetupFixture.shopId,
    shopPackageId: shopWithItemExamplesAndMockSetupFixture.shopPackageId,
    pythPackageId: shopWithItemExamplesAndMockSetupFixture.pythPackageId,
    itemPackageId:
      options.itemPackageId ??
      shopWithItemExamplesAndMockSetupFixture.itemExamplesPackageId,
    mockArtifact: shopWithItemExamplesAndMockSetupFixture.mockArtifact,
    preferredCoinType: options.preferredCoinType,
    preferredCoinLabel: options.preferredCoinLabel
  })

  return {
    ...shopWithItemExamplesAndMockSetupFixture,
    acceptedCurrency
  }
}
