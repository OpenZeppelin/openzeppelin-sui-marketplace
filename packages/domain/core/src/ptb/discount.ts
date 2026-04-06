import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import type { NormalizedRuleKind } from "../models/discount.ts"
import {
  buildObjectIdArgument,
  buildOptionalListingIdArgument
} from "./id-arguments.ts"
import { buildShopOwnerTransactionContext } from "./shop-owner-arguments.ts"

export const buildCreateDiscountTransaction = ({
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
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::create_discount`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildOptionalListingIdArgument(
        transaction,
        appliesToListingId,
        "appliesToListingId"
      ),
      transaction.pure.u8(ruleKind),
      transaction.pure.u64(ruleValue),
      transaction.pure.u64(startsAt),
      transaction.pure.option("u64", expiresAt ?? null),
      transaction.pure.option("u64", maxRedemptions ?? null)
    ]
  })

  return transaction
}

export const buildUpdateDiscountTransaction = ({
  packageId,
  shop,
  discountId,
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
  discountId: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  ownerCapId: string
  sharedClockObject: WrappedSuiSharedObject
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_discount`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildObjectIdArgument(transaction, discountId, "discountId"),
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

export const buildToggleDiscountTransaction = ({
  packageId,
  shop,
  discountId,
  active,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  discountId: string
  active: boolean
  ownerCapId: string
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId,
      shopMutable: true
    })
  transaction.moveCall({
    target: `${packageId}::shop::toggle_discount`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildObjectIdArgument(transaction, discountId, "discountId"),
      transaction.pure.bool(active)
    ]
  })

  return transaction
}
