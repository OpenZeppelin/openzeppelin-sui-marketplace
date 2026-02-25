import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type { NormalizedRuleKind } from "../models/discount.ts"
import { normalizeListingId } from "../models/item-listing.ts"

export const buildCreateDiscountTemplateTransaction = ({
  packageId,
  shop,
  appliesToListingId,
  ruleKind,
  ruleValue,
  startsAt,
  expiresAt,
  maxRedemptions,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  appliesToListingId?: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const normalizedAppliesToListingId = appliesToListingId
    ? normalizeListingId(appliesToListingId, "appliesToListingId")
    : null

  transaction.moveCall({
    target: `${packageId}::shop::create_discount_template`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.option("address", normalizedAppliesToListingId),
      transaction.pure.u8(ruleKind),
      transaction.pure.u64(ruleValue),
      transaction.pure.u64(startsAt),
      transaction.pure.option("u64", expiresAt ?? null),
      transaction.pure.option("u64", maxRedemptions ?? null)
    ]
  })

  return transaction
}

export const buildUpdateDiscountTemplateTransaction = ({
  packageId,
  shop,
  discountTemplate,
  ruleKind,
  ruleValue,
  startsAt,
  expiresAt,
  maxRedemptions,
  ownerCapId,
  sharedClockObject
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountTemplate: WrappedSuiSharedObject
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  ownerCapId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const discountTemplateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_discount_template`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      discountTemplateArgument,
      transaction.pure.u8(ruleKind),
      transaction.pure.u64(ruleValue),
      transaction.pure.u64(startsAt),
      transaction.pure.option("u64", expiresAt ?? null),
      transaction.pure.option("u64", maxRedemptions ?? null),
      clockArgument
    ]
  })

  return transaction
}

export const buildToggleDiscountTemplateTransaction = ({
  packageId,
  shop,
  discountTemplate,
  active,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountTemplate: WrappedSuiSharedObject
  active: boolean
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef({
    ...shop.sharedRef,
    mutable: true
  })
  const discountTemplateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::toggle_discount_template`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      discountTemplateArgument,
      transaction.pure.bool(active)
    ]
  })

  return transaction
}

export const buildPruneDiscountClaimsTransaction = ({
  packageId,
  shop,
  discountTemplate,
  claimers,
  ownerCapId,
  sharedClockObject
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountTemplate: WrappedSuiSharedObject
  claimers: string[]
  ownerCapId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const discountTemplateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::prune_discount_claims`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      discountTemplateArgument,
      transaction.pure.vector("address", claimers),
      clockArgument
    ]
  })

  return transaction
}
