import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

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
  maxPriceStatusLagSecsCap,
  gasBudget
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
  maxConfidenceRatioBpsCap?: number
  maxPriceStatusLagSecsCap?: bigint
  gasBudget?: number
}) => {
  const transaction = newTransaction(gasBudget)

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
      transaction.object(ownerCapId),
      currencyArgument,
      priceInfoArgument,
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.id(pythObjectId),
      transaction.pure.option("u64", maxPriceAgeSecsCap ?? null),
      transaction.pure.option("u16", maxConfidenceRatioBpsCap ?? null),
      transaction.pure.option("u64", maxPriceStatusLagSecsCap ?? null)
    ]
  })

  return transaction
}

export const buildRemoveAcceptedCurrencyTransaction = ({
  packageId,
  shop,
  ownerCapId,
  coinType
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  coinType: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::remove_accepted_currency`,
    typeArguments: [coinType],
    arguments: [shopArgument, transaction.object(ownerCapId)]
  })

  return transaction
}
