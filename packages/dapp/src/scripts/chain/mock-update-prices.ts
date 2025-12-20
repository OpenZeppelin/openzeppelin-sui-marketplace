import type { TransactionArgument } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  SUI_CLOCK_ID,
  type MockPriceFeedConfig
} from "@sui-oracle-market/domain-core/models/pyth"
import { normalizeHex } from "@sui-oracle-market/tooling-core/hex"
import { assertLocalnetNetwork } from "@sui-oracle-market/tooling-core/network"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import type { MockArtifact } from "@sui-oracle-market/tooling-core/types"
import { ensureFoundedAddress } from "@sui-oracle-market/tooling-node/address"
import {
  mockArtifactPath,
  readArtifact,
  writeMockArtifact
} from "@sui-oracle-market/tooling-node/artifacts"
import { getAccountConfig } from "@sui-oracle-market/tooling-node/config"
import { DEFAULT_TX_GAS_BUDGET } from "@sui-oracle-market/tooling-node/constants"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  newTransaction,
  signAndExecute
} from "@sui-oracle-market/tooling-node/transactions"

/**
 * Localnet-only helper to refresh mock Pyth PriceInfoObject timestamps.
 * Keeps oracle freshness checks honest while avoiding manual re-running of mock setup.
 */

type UpdatePricesCliArguments = {
  pythPackageId?: string
}

type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]

type LabeledPriceFeedConfig = MockPriceFeedConfig & { label: string }

const deriveMockPriceComponents = (config: MockPriceFeedConfig) => {
  const priceMagnitude = config.price >= 0n ? config.price : -config.price
  const priceIsNegative = config.price < 0n
  const exponentMagnitude =
    config.exponent >= 0 ? config.exponent : -config.exponent
  const exponentIsNegative = config.exponent < 0

  return {
    priceMagnitude,
    priceIsNegative,
    exponentMagnitude,
    exponentIsNegative
  }
}

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

runSuiScript(
  async ({ network }, cliArguments: UpdatePricesCliArguments) => {
    assertLocalnetNetwork(network.networkName)

    const fullNodeUrl = network.url
    const keypair = await loadKeypair(getAccountConfig(network))
    const signerAddress = keypair.toSuiAddress()

    const suiClient = createSuiClient(fullNodeUrl)

    await ensureFoundedAddress({ signerAddress, signer: keypair }, suiClient)

    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const pythPackageId = resolvePythPackageId(cliArguments, mockArtifact)

    if (
      !mockArtifact.pythPackageId ||
      mockArtifact.pythPackageId !== pythPackageId
    ) {
      await writeMockArtifact(mockArtifactPath, { pythPackageId })
    }

    const priceFeedArtifacts = mockArtifact.priceFeeds ?? []

    if (priceFeedArtifacts.length === 0)
      throw new Error(
        "No mock price feeds found. Run `pnpm chain:mock:setup` before updating prices."
      )

    logKeyValueBlue("Network")(network.networkName)
    logKeyValueBlue("RPC")(fullNodeUrl)
    logKeyValueBlue("Pyth package")(pythPackageId)

    const clockSharedObject = await getSuiSharedObject(
      { objectId: SUI_CLOCK_ID, mutable: false },
      suiClient
    )

    const updateTransaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
    const clockArgument = updateTransaction.sharedObjectRef(
      clockSharedObject.sharedRef
    )

    let updatedCount = 0

    for (const priceFeedArtifact of priceFeedArtifacts) {
      const matchingConfig = findMatchingFeedConfig(priceFeedArtifact)

      if (!matchingConfig) {
        logKeyValueYellow("Skip-feed")(
          `No matching configuration for feed ${priceFeedArtifact.label} (${priceFeedArtifact.feedIdHex}); skipping.`
        )
        continue
      }

      await enqueuePriceUpdate({
        updateTransaction,
        pythPackageId,
        priceFeedArtifact,
        priceFeedConfig: matchingConfig,
        clockArgument,
        suiClient
      })

      updatedCount += 1
    }

    if (updatedCount === 0) {
      logKeyValueYellow("Status")(
        "No price feeds were eligible for update; transaction will not be sent."
      )
      return
    }

    const { transactionResult } = await signAndExecute(
      {
        transaction: updateTransaction,
        signer: keypair,
        networkName: network.networkName
      },
      suiClient
    )

    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
    logKeyValueGreen("updated-feeds")(String(updatedCount))
  },
  yargs()
    .option("pythPackageId", {
      alias: "pyth-package-id",
      type: "string",
      description:
        "Override the Pyth mock package id. Defaults to the value recorded in deployments/mock.localnet.json."
    })
    .strict()
)

const resolvePythPackageId = (
  cliArguments: UpdatePricesCliArguments,
  mockArtifact: MockArtifact
): string => {
  const packageId =
    cliArguments.pythPackageId ?? mockArtifact.pythPackageId ?? ""

  if (!packageId)
    throw new Error(
      "Missing Pyth mock package id. Run `pnpm chain:mock:setup` or pass --pyth-package-id."
    )

  return normalizeSuiObjectId(packageId)
}

const findMatchingFeedConfig = (
  priceFeedArtifact: PriceFeedArtifact
): LabeledPriceFeedConfig | undefined => {
  const normalizedArtifactFeedId = normalizeHex(priceFeedArtifact.feedIdHex)

  return DEFAULT_FEEDS.find(
    (config) =>
      normalizeHex(config.feedIdHex) === normalizedArtifactFeedId ||
      config.label === priceFeedArtifact.label
  )
}

const enqueuePriceUpdate = async ({
  updateTransaction,
  pythPackageId,
  priceFeedArtifact,
  priceFeedConfig,
  clockArgument,
  suiClient
}: {
  updateTransaction: ReturnType<typeof newTransaction>
  pythPackageId: string
  priceFeedArtifact: PriceFeedArtifact
  priceFeedConfig: MockPriceFeedConfig
  clockArgument: TransactionArgument
  suiClient: SuiClient
}) => {
  const priceInfoSharedObject = await getSuiSharedObject(
    { objectId: priceFeedArtifact.priceInfoObjectId, mutable: true },
    suiClient
  )

  const priceInfoArgument = updateTransaction.sharedObjectRef(
    priceInfoSharedObject.sharedRef
  )

  const {
    priceMagnitude,
    priceIsNegative,
    exponentMagnitude,
    exponentIsNegative
  } = deriveMockPriceComponents(priceFeedConfig)

  updateTransaction.moveCall({
    target: `${pythPackageId}::price_info::update_price_feed`,
    arguments: [
      priceInfoArgument,
      updateTransaction.pure.u64(priceMagnitude),
      updateTransaction.pure.bool(priceIsNegative),
      updateTransaction.pure.u64(priceFeedConfig.confidence),
      updateTransaction.pure.u64(exponentMagnitude),
      updateTransaction.pure.bool(exponentIsNegative),
      clockArgument
    ]
  })

  logKeyValueGreen("update-feed")(
    `${priceFeedArtifact.label} ${priceFeedArtifact.priceInfoObjectId}`
  )
}
