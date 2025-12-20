import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

export const buildClaimDiscountTicketTransaction = ({
  packageId,
  shopShared,
  discountTemplateShared,
  sharedClockObject
}: {
  packageId: string
  shopShared: WrappedSuiSharedObject
  discountTemplateShared: WrappedSuiSharedObject
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${packageId}::shop::claim_discount_ticket`,
    arguments: [
      transaction.sharedObjectRef(shopShared.sharedRef),
      transaction.sharedObjectRef(discountTemplateShared.sharedRef),
      transaction.sharedObjectRef(sharedClockObject.sharedRef)
    ]
  })

  return transaction
}
