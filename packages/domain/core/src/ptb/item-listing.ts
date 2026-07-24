import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import type { NormalizedRuleKind } from "../models/discount.ts"
import { buildListingIdArgument } from "./id-arguments.ts"
import { buildShopOwnerTransactionContext } from "./shop-owner-arguments.ts"

export type AddListingSpotlightDiscountInput = {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
}

export const buildAddItemListingTransaction = ({
  packageId,
  itemType,
  shop,
  ownerCapId,
  itemName,
  basePriceUsdCents,
  stock,
  createSpotlightDiscount
}: {
  packageId: string
  itemType: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemName: string
  basePriceUsdCents: bigint
  stock: bigint
  createSpotlightDiscount?: AddListingSpotlightDiscountInput
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })
  const normalizedItemName = itemName.trim()
  if (!normalizedItemName) throw new Error("Item name cannot be empty.")

  if (createSpotlightDiscount) {
    transaction.moveCall({
      target: `${packageId}::shop::add_item_listing_with_discount`,
      typeArguments: [itemType],
      arguments: [
        shopArgument,
        ownerCapabilityArgument,
        transaction.pure.string(normalizedItemName),
        transaction.pure.u64(basePriceUsdCents),
        transaction.pure.u64(stock),
        transaction.pure.u8(createSpotlightDiscount.ruleKind),
        transaction.pure.u64(createSpotlightDiscount.ruleValue),
        transaction.pure.u64(createSpotlightDiscount.startsAt),
        transaction.pure.option(
          "u64",
          createSpotlightDiscount.expiresAt ?? null
        ),
        transaction.pure.option(
          "u64",
          createSpotlightDiscount.maxRedemptions ?? null
        )
      ]
    })
  } else {
    transaction.moveCall({
      target: `${packageId}::shop::add_item_listing`,
      typeArguments: [itemType],
      arguments: [
        shopArgument,
        ownerCapabilityArgument,
        transaction.pure.string(normalizedItemName),
        transaction.pure.u64(basePriceUsdCents),
        transaction.pure.u64(stock)
      ]
    })
  }

  return transaction
}

export const buildRemoveItemListingTransaction = ({
  packageId,
  shop,
  ownerCapId,
  itemListingId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemListingId: string
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::remove_item_listing`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildListingIdArgument(transaction, itemListingId)
    ]
  })

  return transaction
}

export const buildUpdateItemListingStockTransaction = ({
  packageId,
  shop,
  itemListingId,
  ownerCapId,
  newStock
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListingId: string
  ownerCapId: string
  newStock: bigint
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::update_item_listing_stock`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildListingIdArgument(transaction, itemListingId),
      transaction.pure.u64(newStock)
    ]
  })

  return transaction
}
