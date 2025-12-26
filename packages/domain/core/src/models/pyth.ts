import type { Transaction } from "@mysten/sui/transactions"
import { type TransactionArgument } from "@mysten/sui/transactions"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  assertBytesLength,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
export { SUI_CLOCK_ID }

type PythSupportedNetwork = "testnet" | "mainnet"

export type PythPullOracleConfig = {
  hermesUrl: string
  pythStateId: string
  wormholeStateId: string
}

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

export type MockPriceFeedConfig = {
  feedIdHex: string
  price: bigint
  confidence: bigint
  exponent: number
}

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
 * with fresh timestamps so oracle-dependent flows can run end-to-end.
 */
export const publishMockPriceFeed = (
  transaction: Transaction,
  pythPackageId: string,
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
