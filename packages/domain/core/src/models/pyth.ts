import type { Transaction } from "@mysten/sui/transactions"
import { type TransactionArgument } from "@mysten/sui/transactions"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  assertBytesLength,
  hexToBytes,
  normalizeHex
} from "@sui-oracle-market/tooling-core/hex"
export { SUI_CLOCK_ID }

type PythSupportedNetwork = "testnet" | "mainnet"

export type PythPullOracleConfig = {
  hermesUrl: string
  pythStateId: string
  wormholeStateId: string
}

export type PythPullOracleConfigOverrides = Partial<PythPullOracleConfig>

export type PriceUpdatePolicy = "auto" | "required" | "skip"

const PYTH_TESTNET_CONFIG: PythPullOracleConfig = {
  hermesUrl: "https://hermes-beta.pyth.network",
  pythStateId:
    "0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c",
  wormholeStateId:
    "0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790"
}

const PYTH_MAINNET_CONFIG: PythPullOracleConfig = {
  hermesUrl: "https://hermes.pyth.network",
  pythStateId:
    "0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8",
  wormholeStateId:
    "0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c"
}

export const isPythPullSupportedNetwork = (
  networkName: string
): networkName is PythSupportedNetwork =>
  networkName === "testnet" || networkName === "mainnet"

export const getPythPullOracleConfig = (
  networkName: string
): PythPullOracleConfig | undefined => {
  if (networkName === "testnet") return PYTH_TESTNET_CONFIG
  if (networkName === "mainnet") return PYTH_MAINNET_CONFIG
  return undefined
}

export const resolvePythPullOracleConfig = (
  networkName: string,
  override?: PythPullOracleConfig
): PythPullOracleConfig | undefined =>
  override ?? getPythPullOracleConfig(networkName)

export const resolvePythPullOracleConfigWithOverrides = ({
  networkName,
  overrides
}: {
  networkName: string
  overrides?: PythPullOracleConfigOverrides
}): PythPullOracleConfig | undefined => {
  const baseConfig = getPythPullOracleConfig(networkName)
  const mergedConfig: PythPullOracleConfigOverrides = {
    hermesUrl: overrides?.hermesUrl ?? baseConfig?.hermesUrl,
    pythStateId: overrides?.pythStateId ?? baseConfig?.pythStateId,
    wormholeStateId: overrides?.wormholeStateId ?? baseConfig?.wormholeStateId
  }

  return isCompletePythPullOracleConfig(mergedConfig) ? mergedConfig : undefined
}

const isCompletePythPullOracleConfig = (
  config: PythPullOracleConfigOverrides
): config is PythPullOracleConfig =>
  Boolean(config.hermesUrl && config.pythStateId && config.wormholeStateId)

export const requirePythPullOracleConfig = (
  config?: PythPullOracleConfig
): PythPullOracleConfig => {
  if (!config) throw new Error("Missing Pyth pull oracle configuration.")
  return config
}

export type MockPriceFeedConfig = {
  feedIdHex: string
  price: bigint
  confidence: bigint
  exponent: number
}

export type LabeledMockPriceFeedConfig = MockPriceFeedConfig & { label: string }

// Real Pyth feed identifiers taken from the Sui testnet (Pyth beta) network,
// reused on localnet so the same feed-id hex resolves across localnet and
// testnet. Verified against https://hermes-beta.pyth.network (the testnet
// hermes endpoint this repo targets) and listed at
// https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids.
// The price/confidence/exponent values are localnet mock seed values only.
export const DEFAULT_MOCK_PRICE_FEEDS: LabeledMockPriceFeedConfig[] = [
  {
    label: "MOCK_USDC_FEED",
    // Pyth testnet USDC/USD.
    feedIdHex:
      "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
    // $1.00 with exponent -2.
    price: 100n,
    confidence: 1n,
    exponent: -2
  },
  {
    label: "MOCK_BTC_FEED",
    // Pyth testnet BTC/USD.
    feedIdHex:
      "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
    // Approx BTC/USD (Jan 2026). $91,389.00 with exponent -2.
    price: 9_138_900n,
    confidence: 5_000n,
    exponent: -2
  },
  {
    label: "MOCK_SUI_FEED",
    // Pyth testnet SUI/USD.
    feedIdHex:
      "0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266",
    // Approx SUI/USD (Jan 2026). $1.84 with exponent -2.
    price: 184n,
    confidence: 2n,
    exponent: -2
  }
]

type MockFeedMatcher = {
  feedIdHex?: string
  label?: string
}

export const isMatchingMockPriceFeedConfig = (
  config: LabeledMockPriceFeedConfig,
  candidate: MockFeedMatcher
) => {
  const feedIdMatch = candidate.feedIdHex
    ? normalizeHex(candidate.feedIdHex) === normalizeHex(config.feedIdHex)
    : false

  const labelMatch = candidate.label ? candidate.label === config.label : false

  return feedIdMatch || labelMatch
}

export const findMockPriceFeedConfig = (
  candidate: MockFeedMatcher,
  configs: LabeledMockPriceFeedConfig[] = DEFAULT_MOCK_PRICE_FEEDS
) => configs.find((config) => isMatchingMockPriceFeedConfig(config, candidate))

const PYTH_PRICE_INFO_TYPE = "price_info::PriceInfoObject"
/**
 * Returns the fully qualified Move type for a Pyth PriceInfoObject in a given package.
 * Useful when asserting object types on-chain or in RPC reads.
 */
export const getPythPriceInfoType = (pythPackageId: string) =>
  `${pythPackageId}::${PYTH_PRICE_INFO_TYPE}`

/**
 * Derives signed price components for mock price updates.
 */
export const deriveMockPriceComponents = (config: MockPriceFeedConfig) => {
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

/**
 * Adds a Move call to publish and share a mock price feed using the local Pyth stub.
 * Why: Localnet has no VAA/relayer pipeline; this helper materializes a PriceInfoObject
 * with fresh timestamps so oracle-dependent flows can run end-to-end. The mock Pyth
 * `State` is passed as the first argument so the published PriceInfoObject is registered
 * in the `b"price_info"` dynamic-object-field registry, mirroring real Pyth and letting
 * the SDK's `getPriceFeedObjectId(feedId)` resolve the object on localnet.
 */
export const publishMockPriceFeed = (
  transaction: Transaction,
  pythPackageId: string,
  pythStateRef: TransactionArgument,
  config: MockPriceFeedConfig,
  clockObject?: TransactionArgument
): TransactionArgument => {
  const feedIdBytes = assertBytesLength(hexToBytes(config.feedIdHex), 32)
  const {
    priceMagnitude,
    priceIsNegative,
    exponentMagnitude,
    exponentIsNegative
  } = deriveMockPriceComponents(config)

  return transaction.moveCall({
    target: `${pythPackageId}::price_info::publish_price_feed`,
    arguments: [
      pythStateRef,
      // BCS-encode as vector<u8>; passing raw bytes would skip the length prefix and fail deserialization.
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.u64(priceMagnitude),
      transaction.pure.bool(priceIsNegative),
      transaction.pure.u64(config.confidence),
      transaction.pure.u64(exponentMagnitude),
      transaction.pure.bool(exponentIsNegative),
      clockObject ?? transaction.object(SUI_CLOCK_ID)
    ]
  })
}
