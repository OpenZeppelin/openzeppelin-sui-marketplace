/**
 * Localnet-only bootstrap that publishes mock Move packages (coins, items, Pyth) and seeds initial objects.
 * On Sui, publishing a Move package creates on-chain package objects and capabilities, which this script records.
 * If you come from EVM, this is like deploying several contracts and minting starter assets in one flow.
 * It reuses artifact files so repeated runs are idempotent unless you force a re-publish.
 */
import path from "node:path"

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  getPythPriceInfoType,
  publishMockPriceFeed,
  SUI_CLOCK_ID,
  type MockPriceFeedConfig
} from "@sui-oracle-market/domain-core/models/pyth"
import { normalizeHex } from "@sui-oracle-market/tooling-core/hex"
import { assertLocalnetNetwork } from "@sui-oracle-market/tooling-core/network"
import { objectTypeMatches } from "@sui-oracle-market/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
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
import type { MockArtifact } from "../../utils/mocks.ts"
import { mockArtifactPath, writeMockArtifact } from "../../utils/mocks.ts"

type SetupLocalCliArgs = {
  coinPackageId?: string
  coinContractPath: string
  itemPackageId?: string
  itemContractPath: string
  pythPackageId?: string
  pythContractPath: string
  rePublish?: boolean
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

type LabeledPriceFeedConfig = MockPriceFeedConfig & { label: string }
type CoinArtifact = NonNullable<MockArtifact["coins"]>[number]
type ItemTypeArtifact = NonNullable<MockArtifact["itemTypes"]>[number]
type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]

type CoinSeed = {
  label: string
  coinType: string
  initTarget: string
}

const pickRootArtifact = (artifacts: PublishArtifact[]) => {
  const artifact =
    artifacts.find((candidate) => !candidate.isDependency) ?? artifacts[0]
  if (!artifact)
    throw new Error("Publish did not return any artifacts to select from.")
  return artifact
}

// Two sample feeds to seed Pyth price objects with.
const DEFAULT_FEEDS: LabeledPriceFeedConfig[] = [
  {
    label: "MOCK_USD_FEED",
    feedIdHex:
      "0x000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f",
    price: 1_000n,
    confidence: 10n,
    exponent: -2
  },
  {
    label: "MOCK_BTC_FEED",
    feedIdHex:
      "0x101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    price: 25_000n,
    confidence: 50n,
    exponent: -2
  }
]

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
    const {
      suiConfig: { network }
    } = tooling
    // Guard: mock seeding must be localnet-only to avoid leaking dev packages to shared networks.
    assertLocalnetNetwork(network.networkName)

    // Load prior artifacts unless --re-publish was passed (idempotent runs).
    const existingState = await extendCliArguments(cliArguments)

    const fullNodeUrl = network.url

    // Load signer (env/keystore) and derive address; Sui requires explicit key material for PTBs.
    const keypair = tooling.loadedEd25519KeyPair
    const signerAddress = keypair.toSuiAddress()

    // Ensure the account has gas coins (auto-faucet on localnet) to avoid funding errors downstream.
    await tooling.ensureFoundedAddress({
      signerAddress,
      signer: keypair
    })

    // Publish or reuse mock Pyth + mock coin packages; record package IDs for later steps.
    const { coinPackageId, pythPackageId, itemPackageId } =
      await publishMockPackages(
        {
          fullNodeUrl,
          keypair,
          existingState,
          cliArguments
        },
        tooling
      )

    // Fetch shared Coin Registry and Clock objects; required for minting coins and timestamp price feeds.
    const { coinRegistryObject, clockObject } =
      await resolveRegistryAndClockRefs(tooling)

    // Ensure mock coins exist (mint + register in coin registry if missing); reuse if already minted.
    const coins =
      existingState.existingCoins ||
      (await ensureMockCoins(
        {
          coinPackageId,
          owner: signerAddress,
          signer: keypair,
          coinRegistryObject
        },
        tooling
      ))

    // Persist coin artifacts for reuse in later runs/scripts.
    await writeMockArtifact(mockArtifactPath, {
      coins
    })

    // Ensure mock price feeds exist with fresh timestamps; reuse if valid objects already present.
    const priceFeeds =
      existingState.existingPriceFeeds ||
      (await ensurePriceFeeds(
        {
          pythPackageId,
          signer: keypair,
          clockObject,
          existingPriceFeeds: existingState.existingPriceFeeds || []
        },
        tooling
      ))

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
    .strict()
)

const publishMockPackages = async (
  {
    fullNodeUrl: _fullNodeUrl,
    keypair,
    cliArguments,
    existingState
  }: {
    fullNodeUrl: string
    keypair: Ed25519Keypair
    cliArguments: SetupLocalCliArgs
    existingState: ExistingState
  },
  tooling: Tooling
) => {
  // Publish or reuse the local Pyth stub. We allow unpublished deps here because this is localnet-only.
  const pythPackageId =
    existingState.existingPythPackageId ||
    pickRootArtifact(
      await tooling.withTestnetFaucetRetry(
        {
          signerAddress: keypair.toSuiAddress(),
          signer: keypair
        },
        async () =>
          await tooling.publishPackageWithLog({
            packagePath: path.resolve(cliArguments.pythContractPath),
            keypair,
            withUnpublishedDependencies: true,
            useCliPublish: true
          })
      )
    ).packageId

  if (pythPackageId !== existingState.existingPythPackageId)
    await writeMockArtifact(mockArtifactPath, {
      pythPackageId
    })

  // Publish or reuse the local mock coin package.
  const coinPackageId =
    existingState.existingCoinPackageId ||
    pickRootArtifact(
      await tooling.withTestnetFaucetRetry(
        {
          signerAddress: keypair.toSuiAddress(),
          signer: keypair
        },
        async () =>
          await tooling.publishPackageWithLog({
            packagePath: path.resolve(cliArguments.coinContractPath),
            keypair,
            useCliPublish: true
          })
      )
    ).packageId

  if (coinPackageId !== existingState.existingCoinPackageId)
    await writeMockArtifact(mockArtifactPath, {
      coinPackageId
    })

  const itemPackageId =
    existingState.existingItemPackageId ||
    pickRootArtifact(
      await tooling.withTestnetFaucetRetry(
        {
          signerAddress: keypair.toSuiAddress(),
          signer: keypair
        },
        async () =>
          await tooling.publishPackageWithLog({
            packagePath: path.resolve(cliArguments.itemContractPath),
            keypair,
            useCliPublish: true
          })
      )
    ).packageId

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
): Promise<CoinArtifact[]> =>
  await Promise.all(
    buildCoinSeeds(coinPackageId).map(async (seed) => {
      // For each mock coin type, ensure currency/metadata/treasury exist; mint and register if missing.
      return await ensureCoin(
        {
          seed,
          owner,
          signer,
          coinRegistryObject
        },
        tooling
      )
    })
  )

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
): Promise<CoinArtifact> => {
  const { suiClient } = tooling
  const currencyObjectId = deriveCurrencyId(seed.coinType)

  // Read any existing coin metadata/currency object and any minted coin for the owner.
  const [metadata, currencyObject, mintedCoinObjectId] = await Promise.all([
    suiClient.getCoinMetadata({ coinType: seed.coinType }),
    tooling.getObjectSafe({
      objectId: currencyObjectId,
      options: {
        showType: true,
        showBcs: true
      }
    }),
    findOwnedCoinObjectId({ suiClient, owner, coinType: seed.coinType })
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
      label: seed.label,
      coinType: seed.coinType,
      currencyObjectId,
      mintedCoinObjectId
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
    ...created,
    mintedCoinObjectId: created.mintedCoinObjectId ?? mintedCoinObjectId
  }
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

const deriveCurrencyId = (coinType: string) =>
  deriveObjectID(
    SUI_COIN_REGISTRY_ID,
    `0x2::coin_registry::CurrencyKey<${coinType}>`,
    new Uint8Array()
  )

const findMatchingFeed = (
  existingPriceFeeds: PriceFeedArtifact[],
  feedConfig: LabeledPriceFeedConfig
) =>
  existingPriceFeeds.find(
    (feed) =>
      normalizeHex(feed.feedIdHex) === normalizeHex(feedConfig.feedIdHex) ||
      feed.label === feedConfig.label
  )

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
