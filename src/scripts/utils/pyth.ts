import type { Transaction } from "@mysten/sui/transactions"
import { type TransactionArgument } from "@mysten/sui/transactions"
import { assertBytesLength, hexToBytes } from "./hex.ts"

export type MockPriceFeedConfig = {
  feedIdHex: string
  price: bigint
  confidence: bigint
  exponent: number
}

const PYTH_PRICE_INFO_TYPE = "price_info::PriceInfoObject"
export const SUI_CLOCK_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000006"

export const getPythPriceInfoType = (pythPackageId: string) =>
  `${pythPackageId}::${PYTH_PRICE_INFO_TYPE}`

/**
 * Adds a Move call to publish and share a mock price feed using the local Pyth stub.
 * The object will be timestamped with the on-chain clock to satisfy freshness checks.
 */
export const publishMockPriceFeed = (
  transaction: Transaction,
  pythPackageId: string,
  config: MockPriceFeedConfig,
  clockObject?: TransactionArgument
): TransactionArgument => {
  const feedIdBytes = assertBytesLength(hexToBytes(config.feedIdHex), 32)
  const priceMagnitude = config.price >= 0n ? config.price : -config.price
  const priceIsNegative = config.price < 0n
  const expoMagnitude =
    config.exponent >= 0 ? config.exponent : -config.exponent
  const expoIsNegative = config.exponent < 0

  return transaction.moveCall({
    target: `${pythPackageId}::price_info::publish_price_feed`,
    arguments: [
      // BCS-encode as vector<u8>; passing raw bytes would skip the length prefix and fail deserialization.
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.u64(priceMagnitude),
      transaction.pure.bool(priceIsNegative),
      transaction.pure.u64(config.confidence),
      transaction.pure.u64(expoMagnitude),
      transaction.pure.bool(expoIsNegative),
      clockObject ?? transaction.object(SUI_CLOCK_ID)
    ]
  })
}
