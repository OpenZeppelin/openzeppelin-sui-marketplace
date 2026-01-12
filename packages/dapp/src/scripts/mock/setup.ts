/**
 * Localnet bootstrap: publishes mock Move packages (coins/items/Pyth) and seeds objects.
 * Publishes packages, records artifacts, and reuses them to keep runs idempotent.
 */
import path from "node:path"

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { ensureSignerOwnsCoin } from "@sui-oracle-market/domain-core/models/currency"
import {
  DEFAULT_MOCK_PRICE_FEEDS,
  deriveMockPriceComponents,
  getPythPriceInfoType,
  isMatchingMockPriceFeedConfig,
  publishMockPriceFeed,
  SUI_CLOCK_ID,
  type LabeledMockPriceFeedConfig
} from "@sui-oracle-market/domain-core/models/pyth"
import { buildCoinTransferTransaction } from "@sui-oracle-market/tooling-core/coin"
import { deriveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import { assertLocalnetNetwork } from "@sui-oracle-market/tooling-core/network"
import { objectTypeMatches } from "@sui-oracle-market/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { wait } from "@sui-oracle-market/tooling-core/utils/utility"
import { readArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_COIN_REGISTRY_ID
} from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  findCreatedObjectIds,
  newTransaction
} from "@sui-oracle-market/tooling-node/transactions"
import { ensureNativeSuiCurrencyRegistration } from "../../utils/coin-registry.ts"
import type { MockArtifact } from "../../utils/mocks.ts"
import { mockArtifactPath, writeMockArtifact } from "../../utils/mocks.ts"

type SetupLocalCliArgs = {
  buyerAddress?: string
  coinPackageId?: string
  coinContractPath: string
  itemPackageId?: string
  itemContractPath: string
  pythPackageId?: string
  pythContractPath: string
  rePublish?: boolean
  useCliPublish?: boolean
}

type ExistingState = {
  existingCoinPackageId?: string
  existingCoins?: CoinArtifact[]
  existingItemPackageId?: string
  existingItemTypes?: ItemTypeArtifact[]
  existingPythPackageId?: string
  existingPriceFeeds?: PriceFeedArtifact[]
}

// Where the local Pyth stub lives.
const DEFAULT_PYTH_CONTRACT_PATH = path.join(process.cwd(), "move", "pyth-mock")
const DEFAULT_COIN_CONTRACT_PATH = path.join(process.cwd(), "move", "coin-mock")
const DEFAULT_ITEM_EXAMPLES_CONTRACT_PATH = path.join(
  process.cwd(),
  "move",
  "item-examples"
)
const PACKAGE_AVAILABILITY_TIMEOUT_MS = 20_000
const PACKAGE_AVAILABILITY_INTERVAL_MS = 250

type LabeledPriceFeedConfig = LabeledMockPriceFeedConfig
type CoinArtifact = NonNullable<MockArtifact["coins"]>[number]
type ItemTypeArtifact = NonNullable<MockArtifact["itemTypes"]>[number]
type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]
type SeededCoin = {
  coin: CoinArtifact
  wasCreated: boolean
}
type OwnedCoinBalance = {
  coinObjectId: string
  balance: string
}
type OwnedCoinSnapshot = {
  coinObjectId: string
  balance: bigint
}

type CoinSeed = {
  label: string
  coinType: string
  initTarget: string
}

// Two sample feeds to seed Pyth price objects with.
const DEFAULT_FEEDS: LabeledPriceFeedConfig[] = DEFAULT_MOCK_PRICE_FEEDS

const normalizeSetupInputs = (
  cliArguments: SetupLocalCliArgs
): SetupLocalCliArgs => ({
  ...cliArguments,
  buyerAddress: cliArguments.buyerAddress
    ? normalizeSuiAddress(cliArguments.buyerAddress)
    : undefined
})

// Parse CLI flags and reuse prior mock artifacts unless --re-publish is set.
const extendCliArguments = async (
  baseScriptArguments: SetupLocalCliArgs
): Promise<ExistingState> => {
  const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})

  return {
    ...baseScriptArguments,
    existingPythPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.pythPackageId || mockArtifact.pythPackageId,
    existingCoinPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.coinPackageId || mockArtifact.coinPackageId,
    existingItemPackageId: baseScriptArguments.rePublish
      ? undefined
      : baseScriptArguments.itemPackageId || mockArtifact.itemPackageId,
    existingPriceFeeds: baseScriptArguments.rePublish
      ? undefined
      : mockArtifact.priceFeeds,
    existingCoins: baseScriptArguments.rePublish
      ? undefined
      : mockArtifact.coins,
    existingItemTypes: baseScriptArguments.rePublish
      ? undefined
      : mockArtifact.itemTypes
  }
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = normalizeSetupInputs(cliArguments)
    const {
      suiConfig: { network }
    } = tooling
    // Guard: mock seeding must be localnet-only to avoid leaking dev packages to shared networks.
    assertLocalnetNetwork(network.networkName)

    // Load prior artifacts unless --re-publish was passed (idempotent runs).
    const existingState = await extendCliArguments(inputs)

    // Load signer (env/keystore) and derive address; Sui requires explicit key material for PTBs.
    // Ensure the account has gas coins (auto-faucet on localnet) to avoid funding errors downstream.
    await tooling.ensureFoundedAddress({
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    })

    // Publish or reuse mock Pyth + mock coin packages; record package IDs for later steps.
    const { coinPackageId, pythPackageId, itemPackageId } =
      await publishMockPackages(
        {
          existingState,
          cliArguments: inputs
        },
        tooling
      )

    // Fetch shared Coin Registry and Clock objects; required for minting coins and timestamp price feeds.
    const { coinRegistryObject, clockObject } =
      await resolveRegistryAndClockRefs(tooling)

    await ensureNativeSuiCurrencyRegistration(tooling, {
      signer: tooling.loadedEd25519KeyPair,
      coinRegistryObject
    })

    // Ensure mock coins exist (mint + register in coin registry if missing); reuse if already minted.
    const seededCoins =
      existingState.existingCoins?.map((coin) => ({
        coin,
        wasCreated: false
      })) ||
      (await ensureMockCoins(
        {
          coinPackageId,
          owner: tooling.loadedEd25519KeyPair.toSuiAddress(),
          signer: tooling.loadedEd25519KeyPair,
          coinRegistryObject
        },
        tooling
      ))

    const coins = seededCoins.map((seeded) => seeded.coin)

    // Persist coin artifacts for reuse in later runs/scripts.
    await writeMockArtifact(mockArtifactPath, {
      coins
    })

    const createdCoins = seededCoins
      .filter((seeded) => seeded.wasCreated)
      .map((seeded) => seeded.coin)

    if (inputs.buyerAddress)
      await transferHalfTreasuryToBuyer(
        {
          coins: createdCoins,
          buyerAddress: inputs.buyerAddress,
          signer: tooling.loadedEd25519KeyPair,
          signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress()
        },
        tooling
      )
    else logWarning("--buyer-address not supplied skipping fund transfer")

    // Ensure mock price feeds exist with fresh timestamps; reuse if valid objects already present.
    const priceFeeds =
      existingState.existingPriceFeeds ||
      (await ensurePriceFeeds(
        {
          pythPackageId,
          signer: tooling.loadedEd25519KeyPair,
          clockObject,
          existingPriceFeeds: existingState.existingPriceFeeds || []
        },
        tooling
      ))

    // Keep all mock feeds aligned with the configured values (even when reusing existing objects).
    await refreshPriceFeeds(
      {
        pythPackageId,
        signer: tooling.loadedEd25519KeyPair,
        clockObject,
        priceFeeds
      },
      tooling
    )

    // Persist price feed artifacts for reuse.
    await writeMockArtifact(mockArtifactPath, {
      priceFeeds
    })

    const itemTypes =
      existingState.existingItemTypes &&
      existingState.existingItemPackageId === itemPackageId
        ? existingState.existingItemTypes
        : buildItemTypeArtifacts(itemPackageId)

    await writeMockArtifact(mockArtifactPath, {
      itemTypes
    })

    logKeyValueGreen("Pyth package")(pythPackageId)
    logKeyValueGreen("Coin package")(coinPackageId)
    logKeyValueGreen("Item package")(itemPackageId)
    logKeyValueGreen("Feeds")(JSON.stringify(priceFeeds))
    logKeyValueGreen("Coins")(JSON.stringify(coins))
    logKeyValueGreen("Item types")(JSON.stringify(itemTypes))
  },
  yargs()
    .option("buyerAddress", {
      alias: ["buyer-address", "buyer"],
      type: "string",
      description: "Buyer address to receive quarter of each minted mock coin"
    })
    .option("coinPackageId", {
      alias: "coin-package-id",
      type: "string",
      description:
        "Package ID of the Coin Move package on the local localNetwork"
    })
    .option("coinContractPath", {
      alias: "coin-contract-path",
      type: "string",
      description: "Path to the local coin stub Move package to publish",
      default: DEFAULT_COIN_CONTRACT_PATH
    })
    .option("itemPackageId", {
      alias: "item-package-id",
      type: "string",
      description:
        "Package ID of the example item Move package on the local localNetwork"
    })
    .option("itemContractPath", {
      alias: "item-contract-path",
      type: "string",
      description: "Path to the local example item Move package to publish",
      default: DEFAULT_ITEM_EXAMPLES_CONTRACT_PATH
    })
    .option("pythPackageId", {
      alias: "pyth-package-id",
      type: "string",
      description:
        "Package ID of the Pyth Move package on the local localNetwork"
    })
    .option("pythContractPath", {
      alias: "pyth-contract-path",
      type: "string",
      description: "Path to the local Pyth stub Move package to publish",
      default: DEFAULT_PYTH_CONTRACT_PATH
    })
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description: `Re-create and overwrite local mock data`,
      default: false
    })
    .option("useCliPublish", {
      alias: "use-cli-publish",
      type: "boolean",
      description:
        "Publish mock packages with the Sui CLI instead of the SDK (use --no-use-cli-publish to force SDK).",
      default: true
    })
    .strict()
)

const publishMockPackages = async (
  {
    cliArguments,
    existingState
  }: {
    cliArguments: SetupLocalCliArgs
    existingState: ExistingState
  },
  tooling: Tooling
) => {
  // Publish or reuse the local Pyth stub. We allow unpublished deps here because this is localnet-only.
  const pythPackageId =
    existingState.existingPythPackageId ||
    (
      await tooling.publishMovePackageWithFunding({
        packagePath: cliArguments.pythContractPath,
        withUnpublishedDependencies: true,
        clearPublishedEntry: true,
        useCliPublish: cliArguments.useCliPublish
      })
    ).packageId

  if (pythPackageId !== existingState.existingPythPackageId)
    await waitForPackageAvailability(
      pythPackageId,
      tooling.suiClient,
      "pyth-mock"
    )

  if (pythPackageId !== existingState.existingPythPackageId)
    await writeMockArtifact(mockArtifactPath, {
      pythPackageId
    })

  // Publish or reuse the local mock coin package.
  const coinPackageId =
    existingState.existingCoinPackageId ||
    (
      await tooling.publishMovePackageWithFunding({
        packagePath: cliArguments.coinContractPath,
        clearPublishedEntry: true,
        useCliPublish: cliArguments.useCliPublish
      })
    ).packageId

  if (coinPackageId !== existingState.existingCoinPackageId)
    await waitForPackageAvailability(
      coinPackageId,
      tooling.suiClient,
      "coin-mock"
    )

  if (coinPackageId !== existingState.existingCoinPackageId)
    await writeMockArtifact(mockArtifactPath, {
      coinPackageId
    })

  const itemPackageId =
    existingState.existingItemPackageId ||
    (
      await tooling.publishMovePackageWithFunding({
        packagePath: cliArguments.itemContractPath,
        clearPublishedEntry: true,
        useCliPublish: cliArguments.useCliPublish
      })
    ).packageId

  if (itemPackageId !== existingState.existingItemPackageId)
    await waitForPackageAvailability(
      itemPackageId,
      tooling.suiClient,
      "item-examples"
    )

  if (itemPackageId !== existingState.existingItemPackageId)
    await writeMockArtifact(mockArtifactPath, {
      itemPackageId
    })

  return {
    pythPackageId,
    coinPackageId,
    itemPackageId
  }
}

const waitForPackageAvailability = async (
  packageId: string,
  suiClient: SuiClient,
  label: string
) => {
  const start = Date.now()
  let lastError = "package not found"

  while (Date.now() - start < PACKAGE_AVAILABILITY_TIMEOUT_MS) {
    try {
      const response = await suiClient.getObject({
        id: packageId,
        options: { showType: true }
      })

      if (response.data) return
      lastError =
        //@ts-expect-error error can be present for some errors
        response.error?.error ?? response.error?.code ?? "package not found"
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await wait(PACKAGE_AVAILABILITY_INTERVAL_MS)
  }

  throw new Error(
    `Timed out waiting for ${label} package ${packageId}: ${lastError}`
  )
}

const resolveRegistryAndClockRefs = async (
  tooling: Pick<Tooling, "getSuiSharedObject">
) => {
  // Coin registry is a shared object; clock is used to timestamp price feeds for freshness checks.
  const [coinRegistryObject, clockObject] = await Promise.all([
    tooling.getSuiSharedObject({
      objectId: SUI_COIN_REGISTRY_ID,
      mutable: true
    }),
    tooling.getSuiSharedObject({ objectId: SUI_CLOCK_ID })
  ])
  return { coinRegistryObject, clockObject }
}

const ensureMockCoins = async (
  {
    coinPackageId,
    owner,
    signer,
    coinRegistryObject
  }: {
    coinPackageId: string
    owner: string
    signer: Ed25519Keypair
    coinRegistryObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<SeededCoin[]> => {
  const seededCoins: SeededCoin[] = []
  for (const seed of buildCoinSeeds(coinPackageId)) {
    // Serialize shared-coin-registry writes to avoid localnet contention.
    seededCoins.push(
      await ensureCoin(
        {
          seed,
          owner,
          signer,
          coinRegistryObject
        },
        tooling
      )
    )
  }

  return seededCoins
}

const ensureCoin = async (
  {
    seed,
    owner,
    signer,
    coinRegistryObject
  }: {
    seed: CoinSeed
    owner: string
    signer: Ed25519Keypair
    coinRegistryObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<SeededCoin> => {
  const currencyObjectId = deriveCurrencyObjectId(
    seed.coinType,
    SUI_COIN_REGISTRY_ID
  )

  // Read any existing coin metadata/currency object and any minted coin for the owner.
  const [metadata, currencyObject, mintedCoinObjectId] = await Promise.all([
    tooling.suiClient.getCoinMetadata({ coinType: seed.coinType }),
    tooling.getObjectSafe({
      objectId: currencyObjectId,
      options: {
        showType: true,
        showBcs: true
      }
    }),
    findOwnedCoinObjectId({
      suiClient: tooling.suiClient,
      owner,
      coinType: seed.coinType
    })
  ])
  const coinTypeSuffix = `<${seed.coinType}>`
  const currencyType = `0x2::coin_registry::Currency${coinTypeSuffix}`

  if (metadata || objectTypeMatches(currencyObject, currencyType)) {
    // Already initialized; return discovered artifacts (may be partial).
    if (!objectTypeMatches(currencyObject, currencyType)) {
      logWarning(
        `Currency object for ${seed.label} not readable; using derived ID ${currencyObjectId}.`
      )
    } else {
      logKeyValueBlue("Coin")(`${seed.label} ${seed.coinType}`)
    }
    return {
      coin: {
        label: seed.label,
        coinType: seed.coinType,
        currencyObjectId,
        mintedCoinObjectId
      },
      wasCreated: false
    }
  }

  // Not found: initialize the mock coin via coin registry and fund the owner.
  const initTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)

  initTransaction.moveCall({
    target: seed.initTarget,
    arguments: [
      initTransaction.sharedObjectRef(coinRegistryObject.sharedRef),
      initTransaction.pure.address(owner)
    ]
  })

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: initTransaction,
        signer
      })
  )

  // Parse created objects from the transaction (currency, treasury cap, metadata, minted coin).
  const created = coinArtifactsFromResult({
    transactionResult,
    seed,
    derivedCurrencyId: currencyObjectId
  })

  logKeyValueGreen("Coin")(`${seed.label} ${created.currencyObjectId}`)

  return {
    coin: {
      ...created,
      mintedCoinObjectId: created.mintedCoinObjectId ?? mintedCoinObjectId
    },
    wasCreated: true
  }
}

const transferHalfTreasuryToBuyer = async (
  {
    coins,
    buyerAddress,
    signer,
    signerAddress
  }: {
    coins: CoinArtifact[]
    buyerAddress: string
    signer: Ed25519Keypair
    signerAddress: string
  },
  tooling: Tooling
) => {
  if (coins.length === 0) return

  for (const coin of coins) {
    await transferHalfTreasuryForCoin(
      {
        coin,
        buyerAddress,
        signer,
        signerAddress
      },
      tooling
    )
  }
}

const transferHalfTreasuryForCoin = async (
  {
    coin,
    buyerAddress,
    signer,
    signerAddress
  }: {
    coin: CoinArtifact
    buyerAddress: string
    signer: Ed25519Keypair
    signerAddress: string
  },
  tooling: Tooling
) => {
  const treasurySnapshot = await resolveTreasuryCoinSnapshot({
    coinType: coin.coinType,
    owner: signerAddress,
    mintedCoinObjectId: coin.mintedCoinObjectId,
    suiClient: tooling.suiClient
  })

  if (!treasurySnapshot) {
    logWarning(
      `No coin objects found for ${coin.label} (${coin.coinType}); skipping buyer transfer.`
    )
    return
  }

  const transferAmount = calculateQuarterBalance(treasurySnapshot.balance)
  if (transferAmount <= 0n) {
    logWarning(
      `Balance too small to split for ${coin.label} (${coin.coinType}); skipping buyer transfer.`
    )
    return
  }

  const coinSnapshot = await tooling.resolveCoinOwnership({
    coinObjectId: treasurySnapshot.coinObjectId
  })

  ensureSignerOwnsCoin({
    coinObjectId: treasurySnapshot.coinObjectId,
    coinOwnerAddress: coinSnapshot.ownerAddress,
    signerAddress
  })

  const transferTransaction = buildCoinTransferTransaction({
    coinObjectId: treasurySnapshot.coinObjectId,
    amount: transferAmount,
    recipientAddress: buyerAddress
  })

  const { transactionResult } = await tooling.signAndExecute({
    transaction: transferTransaction,
    signer
  })

  logKeyValueGreen("Buyer transfer")(`${coin.label} ${coin.coinType}`)
  logKeyValueGreen("amount")(transferAmount.toString())
  logKeyValueGreen("from")(signerAddress)
  logKeyValueGreen("to")(buyerAddress)
  if (transactionResult.digest)
    logKeyValueGreen("digest")(transactionResult.digest)
}

const coinArtifactsFromResult = ({
  transactionResult,
  seed,
  derivedCurrencyId
}: {
  transactionResult: SuiTransactionBlockResponse
  seed: CoinSeed
  derivedCurrencyId: string
}): CoinArtifact => {
  const coinTypeSuffix = `<${seed.coinType}>`
  const currencyObjectId =
    firstCreatedBySuffix(
      transactionResult,
      `::coin_registry::Currency${coinTypeSuffix}`
    ) ?? derivedCurrencyId

  return {
    label: seed.label,
    coinType: seed.coinType,
    currencyObjectId,
    treasuryCapId: firstCreatedBySuffix(
      transactionResult,
      `::coin::TreasuryCap${coinTypeSuffix}`
    ),
    metadataObjectId: firstCreatedBySuffix(
      transactionResult,
      `::coin::CoinMetadata${coinTypeSuffix}`
    ),
    mintedCoinObjectId: firstCreatedBySuffix(
      transactionResult,
      `::coin::Coin${coinTypeSuffix}`
    )
  }
}

const ensurePriceFeeds = async (
  {
    pythPackageId,
    signer,
    existingPriceFeeds,
    clockObject
  }: {
    pythPackageId: string
    signer: Ed25519Keypair
    existingPriceFeeds: PriceFeedArtifact[]
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact[]> => {
  const priceInfoType = getPythPriceInfoType(pythPackageId)
  const feeds: PriceFeedArtifact[] = []

  for (const feedConfig of DEFAULT_FEEDS) {
    // If a matching feed exists and the object type matches, reuse it.
    const matchingExisting = findMatchingFeed(existingPriceFeeds, feedConfig)
    const existingObject = matchingExisting
      ? await tooling.getObjectSafe({
          objectId: matchingExisting.priceInfoObjectId
        })
      : undefined

    if (matchingExisting && objectTypeMatches(existingObject, priceInfoType)) {
      feeds.push(matchingExisting)
      continue
    }

    if (matchingExisting) {
      logWarning(
        `Feed ${feedConfig.label} not found or mismatched; recreating fresh object.`
      )
    }

    // Publish a fresh price feed object with current timestamps via the mock Pyth package.
    const createdFeed = await publishPriceFeed(
      {
        feedConfig,
        pythPackageId,
        signer,
        clockObject
      },
      tooling
    )
    feeds.push(createdFeed)
  }

  return feeds
}

const refreshPriceFeeds = async (
  {
    pythPackageId,
    signer,
    clockObject,
    priceFeeds
  }: {
    pythPackageId: string
    signer: Ed25519Keypair
    clockObject: WrappedSuiSharedObject
    priceFeeds: PriceFeedArtifact[]
  },
  tooling: Tooling
) => {
  const updateTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  const clockArgument = updateTransaction.sharedObjectRef(clockObject.sharedRef)

  let updatedCount = 0

  for (const priceFeed of priceFeeds) {
    const feedConfig = findMatchingFeedConfig(priceFeed)
    if (!feedConfig) {
      logWarning(
        `No matching feed configuration found for ${priceFeed.label}; skipping update.`
      )
      continue
    }

    const priceInfoSharedObject = await tooling.getSuiSharedObject({
      objectId: priceFeed.priceInfoObjectId,
      mutable: true
    })

    const priceInfoArgument = updateTransaction.sharedObjectRef(
      priceInfoSharedObject.sharedRef
    )

    const {
      priceMagnitude,
      priceIsNegative,
      exponentMagnitude,
      exponentIsNegative
    } = deriveMockPriceComponents(feedConfig)

    updateTransaction.moveCall({
      target: `${pythPackageId}::price_info::update_price_feed`,
      arguments: [
        priceInfoArgument,
        updateTransaction.pure.u64(priceMagnitude),
        updateTransaction.pure.bool(priceIsNegative),
        updateTransaction.pure.u64(feedConfig.confidence),
        updateTransaction.pure.u64(exponentMagnitude),
        updateTransaction.pure.bool(exponentIsNegative),
        clockArgument
      ]
    })

    updatedCount += 1
  }

  if (updatedCount === 0) return

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: updateTransaction,
        signer
      })
  )

  if (transactionResult.digest)
    logKeyValueGreen("refreshed-feeds")(transactionResult.digest)
  logKeyValueGreen("refreshed-feed-count")(String(updatedCount))
}

const findMatchingFeedConfig = (
  priceFeed: PriceFeedArtifact
): LabeledPriceFeedConfig | undefined =>
  DEFAULT_FEEDS.find((feedConfig) =>
    isMatchingMockPriceFeedConfig(feedConfig, priceFeed)
  )

const publishPriceFeed = async (
  {
    feedConfig,
    pythPackageId,
    signer,
    clockObject
  }: {
    feedConfig: LabeledPriceFeedConfig
    pythPackageId: string
    signer: Ed25519Keypair
    clockObject: WrappedSuiSharedObject
  },
  tooling: Tooling
): Promise<PriceFeedArtifact> => {
  const publishPriceFeedTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
  publishMockPriceFeed(
    publishPriceFeedTransaction,
    pythPackageId,
    feedConfig,
    publishPriceFeedTransaction.sharedObjectRef(clockObject.sharedRef)
  )

  const { transactionResult } = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: signer.toSuiAddress(),
      signer
    },
    async () =>
      await tooling.signAndExecute({
        transaction: publishPriceFeedTransaction,
        signer
      })
  )

  const [priceInfoObjectId] = findCreatedObjectIds(
    transactionResult,
    "::price_info::PriceInfoObject"
  )

  if (!priceInfoObjectId)
    throw new Error(`Missing price feed object for ${feedConfig.label}`)

  logKeyValueGreen("Feed")(`${feedConfig.label} ${priceInfoObjectId}`)

  return {
    label: feedConfig.label,
    feedIdHex: feedConfig.feedIdHex,
    priceInfoObjectId
  }
}

const buildCoinSeeds = (coinPackageId: string): CoinSeed[] => {
  const normalizedPackageId = normalizeSuiObjectId(coinPackageId)
  return [
    {
      label: "LocalMockUsd",
      coinType: `${normalizedPackageId}::mock_coin::LocalMockUsd`,
      initTarget: `${normalizedPackageId}::mock_coin::init_local_mock_usd`
    },
    {
      label: "LocalMockBtc",
      coinType: `${normalizedPackageId}::mock_coin::LocalMockBtc`,
      initTarget: `${normalizedPackageId}::mock_coin::init_local_mock_btc`
    }
  ]
}

const buildItemTypeArtifacts = (itemPackageId: string): ItemTypeArtifact[] => {
  const normalizedPackageId = normalizeSuiObjectId(itemPackageId)
  const module = "items"
  const buildItemType = (structName: string) =>
    `${normalizedPackageId}::${module}::${structName}`

  return [
    { label: "Car", itemType: buildItemType("Car") },
    { label: "Bike", itemType: buildItemType("Bike") },
    { label: "ConcertTicket", itemType: buildItemType("ConcertTicket") },
    { label: "DigitalPass", itemType: buildItemType("DigitalPass") }
  ]
}

const findMatchingFeed = (
  existingPriceFeeds: PriceFeedArtifact[],
  feedConfig: LabeledPriceFeedConfig
) =>
  existingPriceFeeds.find((feed) =>
    isMatchingMockPriceFeedConfig(feedConfig, feed)
  )

const resolveTreasuryCoinSnapshot = async ({
  suiClient,
  owner,
  coinType,
  mintedCoinObjectId
}: {
  suiClient: SuiClient
  owner: string
  coinType: string
  mintedCoinObjectId?: string
}): Promise<OwnedCoinSnapshot | undefined> => {
  try {
    const coins = await suiClient.getCoins({ owner, coinType })
    const ownedCoins = (coins.data ?? []) as OwnedCoinBalance[]
    if (!ownedCoins.length) return undefined

    const preferredCoinId = mintedCoinObjectId
      ? normalizeSuiObjectId(mintedCoinObjectId)
      : undefined

    const preferredCoin = preferredCoinId
      ? ownedCoins.find(
          (coin) => normalizeSuiObjectId(coin.coinObjectId) === preferredCoinId
        )
      : undefined

    const selectedCoin = preferredCoin ?? selectRichestCoin(ownedCoins)
    if (!selectedCoin) return undefined

    return {
      coinObjectId: selectedCoin.coinObjectId,
      balance: BigInt(selectedCoin.balance)
    }
  } catch {
    return undefined
  }
}

const selectRichestCoin = (coins: OwnedCoinBalance[]) =>
  coins.reduce<OwnedCoinBalance | undefined>((richest, coin) => {
    if (!richest) return coin
    return BigInt(coin.balance) > BigInt(richest.balance) ? coin : richest
  }, undefined)

const calculateQuarterBalance = (balance: bigint) => balance / 4n

const findOwnedCoinObjectId = async ({
  suiClient,
  owner,
  coinType
}: {
  suiClient: SuiClient
  owner: string
  coinType: string
}) => {
  try {
    const coins = await suiClient.getCoins({ owner, coinType, limit: 1 })
    return coins.data?.[0]?.coinObjectId
  } catch {
    return undefined
  }
}

const firstCreatedBySuffix = (
  result: SuiTransactionBlockResponse,
  suffix: string
) => findCreatedObjectIds(result, suffix)[0]
