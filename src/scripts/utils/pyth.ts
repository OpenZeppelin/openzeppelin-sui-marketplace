import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import { assertBytesLength, hexToBytes } from "./hex";

export type MockPriceFeedConfig = {
  feedIdHex: string;
  price: bigint;
  confidence: bigint;
  exponent: number;
};

const PYTH_PRICE_INFO_TYPE = "price_info::PriceInfoObject";
export const SUI_CLOCK_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000006";

export const getPythPriceInfoType = (pythPackageId: string) =>
  `${pythPackageId}::${PYTH_PRICE_INFO_TYPE}`;

/**
 * Adds a Move call to publish and share a mock price feed using the local Pyth stub.
 * The object will be timestamped with the on-chain clock to satisfy freshness checks.
 */
export const publishMockPriceFeed = (
  tx: Transaction,
  pythPackageId: string,
  config: MockPriceFeedConfig,
  clockObject?: TransactionArgument
): TransactionArgument => {
  const feedIdBytes = assertBytesLength(hexToBytes(config.feedIdHex), 32);
  const priceMagnitude = config.price >= 0n ? config.price : -config.price;
  const priceIsNegative = config.price < 0n;
  const expoMagnitude = config.exponent >= 0 ? config.exponent : -config.exponent;
  const expoIsNegative = config.exponent < 0;

  return tx.moveCall({
    target: `${pythPackageId}::price_info::publish_price_feed`,
    arguments: [
      tx.pure(new Uint8Array(feedIdBytes)),
      tx.pure.u64(priceMagnitude),
      tx.pure.bool(priceIsNegative),
      tx.pure.u64(config.confidence),
      tx.pure.u64(expoMagnitude),
      tx.pure.bool(expoIsNegative),
      clockObject ?? tx.object(SUI_CLOCK_ID),
    ],
  });
};
