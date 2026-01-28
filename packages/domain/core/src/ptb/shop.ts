import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

export const buildCreateShopTransaction = ({
  packageId,
  shopName
}: {
  packageId: string
  shopName: string
}) => {
  const transaction = newTransaction()
  const normalizedShopName = shopName.trim()
  if (!normalizedShopName) throw new Error("Shop name cannot be empty.")

  transaction.moveCall({
    target: `${packageId}::shop::create_shop`,
    arguments: [transaction.pure.string(normalizedShopName)]
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
