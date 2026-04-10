import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import {
  getDiscountSummary,
  type NormalizedRuleKind
} from "../models/discount.ts"
import {
  getItemListingSummary,
  normalizeListingId
} from "../models/item-listing.ts"
import {
  buildListingIdArgument,
  buildObjectIdArgument,
  buildOptionalObjectIdArgument
} from "./id-arguments.ts"
import { buildShopOwnerTransactionContext } from "./shop-owner-arguments.ts"

type ListingMetadata = {
  id: string
  shopId: string
}

type DiscountMetadata = {
  id: string
  shopId: string
  appliesToListing?: string
}

export type AddListingSpotlightDiscountInput = {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
}

export const getItemListingMetadata = async (
  listingId: string,
  shopId: string,
  suiClient: SuiClient
): Promise<ListingMetadata> => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const normalizedListingId = normalizeListingId(listingId)

  await getItemListingSummary(normalizedShopId, normalizedListingId, suiClient)

  return {
    id: normalizedListingId,
    shopId: normalizedShopId
  }
}

export const getDiscountMetadata = async (
  discountId: string,
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountMetadata> => {
  const discountSummary = await getDiscountSummary(
    shopId,
    discountId,
    suiClient
  )

  return {
    id: discountSummary.discountId,
    shopId: discountSummary.shopId,
    appliesToListing: discountSummary.appliesToListingId
  }
}

export const validateDiscountAndListing = async ({
  shopId,
  itemListingId,
  discountId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  discountId: string
  suiClient: SuiClient
}): Promise<{ itemListingId: string; discountId: string }> => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const [listing, resolvedDiscount] = await Promise.all([
    getItemListingMetadata(itemListingId, normalizedShopId, suiClient),
    getDiscountMetadata(discountId, normalizedShopId, suiClient)
  ])

  if (resolvedDiscount.shopId !== normalizedShopId)
    throw new Error(
      `Discount ${resolvedDiscount.id} belongs to shop ${resolvedDiscount.shopId}, not ${normalizedShopId}.`
    )

  if (
    resolvedDiscount.appliesToListing &&
    resolvedDiscount.appliesToListing !== listing.id
  )
    throw new Error(
      `Discount ${resolvedDiscount.id} is pinned to listing ${resolvedDiscount.appliesToListing} and cannot be attached to ${listing.id}. Create a discount for this listing or use the pinned listing.`
    )

  return {
    itemListingId: listing.id,
    discountId: resolvedDiscount.id
  }
}

export const resolveListingIdForShop = async ({
  shopId,
  itemListingId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  suiClient: SuiClient
}): Promise<string> =>
  (
    await getItemListingMetadata(
      itemListingId,
      normalizeSuiObjectId(shopId),
      suiClient
    )
  ).id

export const buildAddItemListingTransaction = ({
  packageId,
  itemType,
  shop,
  ownerCapId,
  itemName,
  basePriceUsdCents,
  stock,
  spotlightDiscountId,
  createSpotlightDiscount
}: {
  packageId: string
  itemType: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemName: string
  basePriceUsdCents: bigint
  stock: bigint
  spotlightDiscountId?: string
  createSpotlightDiscount?: AddListingSpotlightDiscountInput
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })
  const normalizedItemName = itemName.trim()
  if (!normalizedItemName) throw new Error("Item name cannot be empty.")
  if (spotlightDiscountId && createSpotlightDiscount)
    throw new Error(
      "Choose either spotlightDiscountId or createSpotlightDiscount, but not both."
    )

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
        transaction.pure.u64(stock),
        buildOptionalObjectIdArgument(
          transaction,
          spotlightDiscountId,
          "spotlightDiscountId"
        )
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

export const buildAttachDiscountTransaction = ({
  packageId,
  shop,
  itemListingId,
  discountId,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListingId: string
  discountId: string
  ownerCapId: string
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::add_spotlight_discount`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildObjectIdArgument(transaction, discountId, "discountId"),
      buildListingIdArgument(transaction, itemListingId)
    ]
  })

  return transaction
}

export const buildClearDiscountTransaction = ({
  packageId,
  shop,
  itemListingId,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListingId: string
  ownerCapId: string
}) => {
  const { transaction, shopArgument, ownerCapabilityArgument } =
    buildShopOwnerTransactionContext({
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::clear_spotlight_discount`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildListingIdArgument(transaction, itemListingId)
    ]
  })

  return transaction
}
