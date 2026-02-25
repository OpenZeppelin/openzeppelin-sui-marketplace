import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import {
  getDiscountTemplateSummary,
  type NormalizedRuleKind
} from "../models/discount.ts"
import {
  getItemListingSummary,
  normalizeListingId
} from "../models/item-listing.ts"
import { buildShopOwnerCapabilityArguments } from "./shop-owner-arguments.ts"

type ListingMetadata = {
  id: string
  shopId: string
}

type DiscountTemplateMetadata = {
  id: string
  shopId: string
  appliesToListing?: string
}

const toListingIdU64 = (listingId: string): bigint =>
  BigInt(normalizeListingId(listingId))

const buildListingIdArgument = (
  transaction: ReturnType<typeof newTransaction>,
  listingId: string
) => transaction.pure.u64(toListingIdU64(listingId))

export type AddListingSpotlightTemplateInput = {
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

export const getDiscountTemplateMetadata = async (
  templateId: string,
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateMetadata> => {
  const templateSummary = await getDiscountTemplateSummary(
    shopId,
    templateId,
    suiClient
  )

  return {
    id: templateSummary.discountTemplateId,
    shopId: templateSummary.shopId,
    appliesToListing: templateSummary.appliesToListingId
  }
}

export const validateTemplateAndListing = async ({
  shopId,
  itemListingId,
  discountTemplateId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  discountTemplateId: string
  suiClient: SuiClient
}): Promise<{ itemListingId: string; discountTemplateId: string }> => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const [listing, template] = await Promise.all([
    getItemListingMetadata(itemListingId, normalizedShopId, suiClient),
    getDiscountTemplateMetadata(discountTemplateId, normalizedShopId, suiClient)
  ])

  if (template.shopId !== normalizedShopId)
    throw new Error(
      `Discount template ${template.id} belongs to shop ${template.shopId}, not ${normalizedShopId}.`
    )

  if (template.appliesToListing && template.appliesToListing !== listing.id)
    throw new Error(
      `Discount template ${template.id} is pinned to listing ${template.appliesToListing} and cannot be attached to ${listing.id}. Create a template for this listing or use the pinned listing.`
    )

  return {
    itemListingId: listing.id,
    discountTemplateId: template.id
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
  createSpotlightDiscountTemplate
}: {
  packageId: string
  itemType: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemName: string
  basePriceUsdCents: bigint
  stock: bigint
  spotlightDiscountId?: string
  createSpotlightDiscountTemplate?: AddListingSpotlightTemplateInput
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })
  const normalizedItemName = itemName.trim()
  if (!normalizedItemName) throw new Error("Item name cannot be empty.")
  if (spotlightDiscountId && createSpotlightDiscountTemplate)
    throw new Error(
      "Choose either spotlightDiscountId or createSpotlightDiscountTemplate, but not both."
    )

  if (createSpotlightDiscountTemplate) {
    transaction.moveCall({
      target: `${packageId}::shop::add_item_listing_with_discount_template`,
      typeArguments: [itemType],
      arguments: [
        shopArgument,
        ownerCapabilityArgument,
        transaction.pure.string(normalizedItemName),
        transaction.pure.u64(basePriceUsdCents),
        transaction.pure.u64(stock),
        transaction.pure.u8(createSpotlightDiscountTemplate.ruleKind),
        transaction.pure.u64(createSpotlightDiscountTemplate.ruleValue),
        transaction.pure.u64(createSpotlightDiscountTemplate.startsAt),
        transaction.pure.option(
          "u64",
          createSpotlightDiscountTemplate.expiresAt ?? null
        ),
        transaction.pure.option(
          "u64",
          createSpotlightDiscountTemplate.maxRedemptions ?? null
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
        transaction.pure.option("address", spotlightDiscountId ?? null)
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
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
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
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
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

export const buildAttachDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListingId,
  discountTemplateId,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListingId: string
  discountTemplateId: string
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::attach_template_to_listing`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      transaction.pure.address(discountTemplateId),
      buildListingIdArgument(transaction, itemListingId)
    ]
  })

  return transaction
}

export const buildClearDiscountTemplateTransaction = ({
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
  const transaction = newTransaction()
  const [shopArgument, ownerCapabilityArgument] =
    buildShopOwnerCapabilityArguments({
      transaction,
      shop,
      ownerCapId
    })

  transaction.moveCall({
    target: `${packageId}::shop::clear_template_from_listing`,
    arguments: [
      shopArgument,
      ownerCapabilityArgument,
      buildListingIdArgument(transaction, itemListingId)
    ]
  })

  return transaction
}
