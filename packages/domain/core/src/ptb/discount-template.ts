import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type { NormalizedRuleKind } from "../models/discount.ts"
import { normalizeListingId } from "../models/item-listing.ts"
import { buildShopOwnerCapabilityArguments } from "./shop-owner-arguments.ts"

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
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })
  const normalizedAppliesToListingId = appliesToListingId
    ? normalizeListingId(appliesToListingId, "appliesToListingId")
    : null

  transaction.moveCall({
    target: `${packageId}::shop::create_discount_template`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
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
  discountTemplateId,
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
  discountTemplateId: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  ownerCapId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_discount_template`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      transaction.pure.address(discountTemplateId),
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
  discountTemplateId,
  active,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountTemplateId: string
  active: boolean
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId,
      shopMutable: true
    })
  transaction.moveCall({
    target: `${packageId}::shop::toggle_discount_template`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      transaction.pure.address(discountTemplateId),
      transaction.pure.bool(active)
    ]
  })

  return transaction
}

export const buildPruneDiscountClaimsTransaction = ({
  packageId,
  shop,
  discountTemplateId,
  claimers,
  ownerCapId,
  sharedClockObject
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountTemplateId: string
  claimers: string[]
  ownerCapId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::prune_discount_claims`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      transaction.pure.address(discountTemplateId),
      transaction.pure.vector("address", claimers),
      clockArgument
    ]
  })

  return transaction
}
