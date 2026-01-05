import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  type ScriptArgumentMap,
  type ScriptRunOptions,
  type ScriptRunResult,
  type SuiScriptRunner
} from "@sui-oracle-market/tooling-node/testing/scripts"
import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"
import type {
  TestAccount,
  TestContext
} from "@sui-oracle-market/tooling-node/testing/localnet"

export type ScriptJsonOptions = Omit<ScriptRunOptions, "args"> & {
  args?: ScriptArgumentMap
}

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

export const createDappIntegrationTestEnv = () =>
  createSuiLocalnetTestEnv({
    mode: "suite",
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
  shopId: string
  shopName: string
  shopCreateOutput: ShopCreateOutput
}

export type ShopFixtureOptions = {
  shopName?: string
  publisherLabel?: string
  funding?: FundingOptions
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

const DEFAULT_FUNDING_OPTIONS: FundingOptions = {
  minimumCoinObjects: 2
}

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
  const publisher = await createFundedTestAccount(context, {
    label: options.publisherLabel,
    funding: options.funding
  })
  const scriptRunner = createScriptRunner(context)
  const oracleMarketArtifact = await publishMovePackage(
    context,
    publisher,
    "oracle-market"
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
