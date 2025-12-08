import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import { assertBytesLength, hexToBytes } from "./hex";

export type MockPriceFeedConfig = {
  feedIdHex: string;
  price: bigint;
  confidence: bigint;
  exponent: number;
  attestationTime?: bigint;
  arrivalTime?: bigint;
};

const PYTH_PRICE_INFO_TYPE = "pyth::price_info::PriceInfoObject";

export const getPythPriceInfoType = (pythPackageId: string) =>
  `${pythPackageId}::${PYTH_PRICE_INFO_TYPE}`;

export const buildMockPriceInfoObject = (
  tx: Transaction,
  pythPackageId: string,
  config: MockPriceFeedConfig
): TransactionArgument => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const attestationTime = config.attestationTime ?? now;
  const arrivalTime = config.arrivalTime ?? now;

  const priceMagnitude = config.price >= 0n ? config.price : -config.price;
  const priceIsNegative = config.price < 0n;
  const expoMagnitude = config.exponent >= 0 ? config.exponent : -config.exponent;
  const expoIsNegative = config.exponent < 0;

  const priceValue = tx.moveCall({
    target: `${pythPackageId}::i64::new`,
    arguments: [tx.pure.u64(priceMagnitude), tx.pure.bool(priceIsNegative)],
  });

  const expoValue = tx.moveCall({
    target: `${pythPackageId}::i64::new`,
    arguments: [tx.pure.u64(expoMagnitude), tx.pure.bool(expoIsNegative)],
  });

  const priceStruct = tx.moveCall({
    target: `${pythPackageId}::price::new`,
    arguments: [
      priceValue,
      tx.pure.u64(config.confidence),
      expoValue,
      tx.pure.u64(attestationTime),
    ],
  });

  const feedIdBytes = assertBytesLength(hexToBytes(config.feedIdHex), 32);
  const priceIdentifier = tx.moveCall({
    target: `${pythPackageId}::price_identifier::from_byte_vec`,
    arguments: [tx.pure(new Uint8Array(feedIdBytes))],
  });

  const priceInfoObject = tx.moveCall({
    target: `${pythPackageId}::price_info::dev_new_price_info_object_with_feed`,
    arguments: [
      priceIdentifier,
      priceStruct,
      priceStruct,
      tx.pure.u64(attestationTime),
      tx.pure.u64(arrivalTime),
    ],
  });

  // Share so any caller can reuse the mock feed during checkout.
  tx.moveCall({
    target: "0x2::transfer::public_share_object",
    arguments: [priceInfoObject],
  });

  return priceInfoObject;
};
