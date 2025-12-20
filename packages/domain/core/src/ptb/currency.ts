import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"

import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

export const deriveCurrencyObjectId = (coinType: string, registryId: string) =>
  normalizeSuiObjectId(
    deriveObjectID(
      registryId,
      `0x2::coin_registry::CurrencyKey<${coinType}>`,
      new Uint8Array()
    )
  )

export const buildAddAcceptedCurrencyTransaction = ({
  packageId,
  coinType,
  shop,
  currency,
  feedIdBytes,
  pythObjectId,
  priceInfoObject,
  ownerCapId,
  maxPriceAgeSecsCap,
  maxConfidenceRatioBpsCap,
  maxPriceStatusLagSecsCap
}: {
  packageId: string
  coinType: string
  shop: WrappedSuiSharedObject
  currency: WrappedSuiSharedObject
  feedIdBytes: number[]
  pythObjectId: string
  priceInfoObject: WrappedSuiSharedObject
  ownerCapId: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: bigint
  maxPriceStatusLagSecsCap?: bigint
}) => {
  const transaction = newTransaction()

  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const currencyArgument = transaction.sharedObjectRef(currency.sharedRef)
  const priceInfoArgument = transaction.sharedObjectRef(
    priceInfoObject.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::add_accepted_currency`,
    typeArguments: [coinType],
    arguments: [
      shopArgument,
      currencyArgument,
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.id(pythObjectId),
      priceInfoArgument,
      transaction.pure.option("u64", maxPriceAgeSecsCap ?? null),
      transaction.pure.option("u64", maxConfidenceRatioBpsCap ?? null),
      transaction.pure.option("u64", maxPriceStatusLagSecsCap ?? null),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

export const buildRemoveAcceptedCurrencyTransaction = ({
  packageId,
  shop,
  ownerCapId,
  acceptedCurrency
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  acceptedCurrency: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const acceptedCurrencyArgument = transaction.sharedObjectRef(
    acceptedCurrency.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::remove_accepted_currency`,
    arguments: [
      shopArgument,
      acceptedCurrencyArgument,
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}
