import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { getObjectWithDynamicFieldFallback } from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

type ListingMetadata = {
  id: string
  shopId: string
}

type DiscountTemplateMetadata = {
  id: string
  shopId: string
  appliesToListing?: string
}

export const getItemListingMetadata = async (
  listingId: string,
  shopId: string,
  suiClient: SuiClient
): Promise<ListingMetadata> => {
  const object = await getObjectWithDynamicFieldFallback(
    { objectId: listingId, parentObjectId: shopId },
    { suiClient }
  )

  const fields = unwrapMoveObjectFields(object)
  const listingShopId = normalizeOptionalIdFromValue(fields.shop_id)
  if (!listingShopId)
    throw new Error(`Item listing ${listingId} is missing a shop_id field.`)
  const normalizedListingId =
    normalizeOptionalIdFromValue(fields.id) ?? normalizeSuiObjectId(listingId)

  return {
    id: normalizedListingId,
    shopId: listingShopId
  }
}

export const getDiscountTemplateMetadata = async (
  templateId: string,
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateMetadata> => {
  const object = await getObjectWithDynamicFieldFallback(
    { objectId: templateId, parentObjectId: shopId },
    { suiClient }
  )

  const fields = unwrapMoveObjectFields(object)
  const templateShopId = normalizeOptionalIdFromValue(fields.shop_id)
  if (!templateShopId)
    throw new Error(
      `Discount template ${templateId} is missing a shop_id field.`
    )

  return {
    id:
      normalizeOptionalIdFromValue(fields.id) ??
      normalizeSuiObjectId(templateId),
    shopId: templateShopId,
    appliesToListing: normalizeOptionalIdFromValue(fields.applies_to_listing)
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
  const [listing, template] = await Promise.all([
    getItemListingMetadata(itemListingId, shopId, suiClient),
    getDiscountTemplateMetadata(discountTemplateId, shopId, suiClient)
  ])

  const normalizedShopId = normalizeSuiObjectId(shopId)

  // Defensive cross-shop check: prevents attaching a foreign listing/template to this Shop.
  if (listing.shopId !== normalizedShopId)
    throw new Error(
      `Item listing ${listing.id} belongs to shop ${listing.shopId}, not ${normalizedShopId}.`
    )

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
}): Promise<string> => {
  const listing = await getItemListingMetadata(itemListingId, shopId, suiClient)
  const normalizedShopId = normalizeSuiObjectId(shopId)

  if (listing.shopId !== normalizedShopId)
    throw new Error(
      `Item listing ${itemListingId} belongs to shop ${listing.shopId}, not ${normalizedShopId}.`
    )

  return listing.id
}

export const buildAddItemListingTransaction = ({
  packageId,
  itemType,
  shop,
  ownerCapId,
  itemName,
  basePriceUsdCents,
  stock,
  spotlightDiscountId
}: {
  packageId: string
  itemType: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemName: string
  basePriceUsdCents: bigint
  stock: bigint
  spotlightDiscountId?: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const normalizedItemName = itemName.trim()
  if (!normalizedItemName) throw new Error("Item name cannot be empty.")

  transaction.moveCall({
    target: `${packageId}::shop::add_item_listing`,
    typeArguments: [itemType],
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.string(normalizedItemName),
      transaction.pure.u64(basePriceUsdCents),
      transaction.pure.u64(stock),
      transaction.pure.option("address", spotlightDiscountId ?? null)
    ]
  })

  return transaction
}

export const buildRemoveItemListingTransaction = ({
  packageId,
  shop,
  ownerCapId,
  itemListing
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemListing: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::remove_item_listing`,
    arguments: [shopArgument, transaction.object(ownerCapId), listingArgument]
  })

  return transaction
}

export const buildUpdateItemListingStockTransaction = ({
  packageId,
  shop,
  itemListing,
  ownerCapId,
  newStock
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListing: WrappedSuiSharedObject
  ownerCapId: string
  newStock: bigint
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_item_listing_stock`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      listingArgument,
      transaction.pure.u64(newStock)
    ]
  })

  return transaction
}

export const buildAttachDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListing,
  discountTemplate,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListing: WrappedSuiSharedObject
  discountTemplate: WrappedSuiSharedObject
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)
  const templateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::attach_template_to_listing`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      listingArgument,
      templateArgument
    ]
  })

  return transaction
}

export const buildClearDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListing,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListing: WrappedSuiSharedObject
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::clear_template_from_listing`,
    arguments: [shopArgument, transaction.object(ownerCapId), listingArgument]
  })

  return transaction
}
