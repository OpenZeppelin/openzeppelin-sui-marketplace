import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

export const buildCreateShopTransaction = ({
  packageId,
  publisherCapId
}: {
  packageId: string
  publisherCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::shop::create_shop`,
    arguments: [transaction.object(publisherCapId)]
  })

  return transaction
}

export const buildUpdateShopOwnerTransaction = ({
  packageId,
  shop,
  ownerCapId,
  newOwner
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  newOwner: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_shop_owner`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.address(newOwner)
    ]
  })

  return transaction
}
