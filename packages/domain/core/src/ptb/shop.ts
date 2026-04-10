import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

export const buildCreateShopTransaction = ({
  packageId,
  shopName,
  ownerAddress
}: {
  packageId: string
  shopName: string
  ownerAddress: string
}) => {
  const transaction = newTransaction()
  const normalizedShopName = shopName.trim()
  if (!normalizedShopName) throw new Error("Shop name cannot be empty.")

  const [, ownerCapability] = transaction.moveCall({
    target: `${packageId}::shop::create_shop_and_share`,
    arguments: [transaction.pure.string(normalizedShopName)]
  })

  transaction.transferObjects(
    [ownerCapability],
    transaction.pure.address(ownerAddress)
  )

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

export const buildToggleShopTransaction = ({
  packageId,
  shop,
  ownerCapId,
  active
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  active: boolean
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::toggle_shop`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.bool(active)
    ]
  })

  return transaction
}
