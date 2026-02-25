import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { buildShopSharedArgument } from "./shop-owner-arguments.ts"

export const buildClaimDiscountTicketTransaction = ({
  packageId,
  shopShared,
  discountTemplateId,
  sharedClockObject
}: {
  packageId: string
  shopShared: WrappedSuiSharedObject
  discountTemplateId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const shopArgument = buildShopSharedArgument({
    transaction,
    shop: shopShared
  })

  transaction.moveCall({
    target: `${packageId}::shop::claim_discount_ticket`,
    arguments: [
      shopArgument,
      transaction.pure.address(discountTemplateId),
      transaction.sharedObjectRef(sharedClockObject.sharedRef)
    ]
  })

  return transaction
}
