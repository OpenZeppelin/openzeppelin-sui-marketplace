import type { Transaction } from "@mysten/sui/transactions"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

type TransactionBuilder = Transaction

const resolveShopSharedReference = ({
  shop,
  mutable
}: {
  shop: WrappedSuiSharedObject
  mutable?: boolean
}) => (mutable === undefined ? shop.sharedRef : { ...shop.sharedRef, mutable })

export const buildShopSharedArgument = ({
  transaction,
  shop,
  mutable
}: {
  transaction: TransactionBuilder
  shop: WrappedSuiSharedObject
  mutable?: boolean
}) => transaction.sharedObjectRef(resolveShopSharedReference({ shop, mutable }))

export const buildOwnerCapabilityArgument = ({
  transaction,
  ownerCapId
}: {
  transaction: TransactionBuilder
  ownerCapId: string
}) => transaction.object(ownerCapId)

export const buildShopOwnerCapabilityArguments = ({
  transaction,
  shop,
  ownerCapId,
  shopMutable
}: {
  transaction: TransactionBuilder
  shop: WrappedSuiSharedObject
  ownerCapId: string
  shopMutable?: boolean
}) =>
  [
    buildShopSharedArgument({
      transaction,
      shop,
      mutable: shopMutable
    }),
    buildOwnerCapabilityArgument({
      transaction,
      ownerCapId
    })
  ] as const

export const buildShopOwnerTransactionContext = ({
  shop,
  ownerCapId,
  shopMutable
}: {
  shop: WrappedSuiSharedObject
  ownerCapId: string
  shopMutable?: boolean
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId,
      shopMutable
    })

  return { transaction, shopArgument, ownerCapabilityArgument } as const
}
