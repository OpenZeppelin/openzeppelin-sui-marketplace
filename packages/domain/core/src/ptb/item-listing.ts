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
  shopAddress: string
}

type DiscountTemplateMetadata = {
  id: string
  shopAddress: string
  appliesToListing?: string
}

export const encodeItemName = (name: string): Uint8Array => {
  if (!name.trim()) throw new Error("Item name cannot be empty.")
  return new TextEncoder().encode(name)
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
  const rawShopAddress = fields.shop_address
  if (typeof rawShopAddress !== "string")
    throw new Error(
      `Item listing ${listingId} is missing a shop_address field.`
    )

  const shopAddress = normalizeSuiObjectId(rawShopAddress)
  const normalizedListingId =
    normalizeOptionalIdFromValue(fields.id) ?? normalizeSuiObjectId(listingId)

  return {
    id: normalizedListingId,
    shopAddress
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
  const rawShopAddress = fields.shop_address
  if (typeof rawShopAddress !== "string")
    throw new Error(
      `Discount template ${templateId} is missing a shop_address field.`
    )

  return {
    id:
      normalizeOptionalIdFromValue(fields.id) ??
      normalizeSuiObjectId(templateId),
    shopAddress: normalizeSuiObjectId(rawShopAddress),
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
  if (listing.shopAddress !== normalizedShopId)
    throw new Error(
      `Item listing ${listing.id} belongs to shop ${listing.shopAddress}, not ${normalizedShopId}.`
    )

  if (template.shopAddress !== normalizedShopId)
    throw new Error(
      `Discount template ${template.id} belongs to shop ${template.shopAddress}, not ${normalizedShopId}.`
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

  if (listing.shopAddress !== normalizedShopId)
    throw new Error(
      `Item listing ${itemListingId} belongs to shop ${listing.shopAddress}, not ${normalizedShopId}.`
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

  transaction.moveCall({
    target: `${packageId}::shop::add_item_listing`,
    typeArguments: [itemType],
    arguments: [
      shopArgument,
      transaction.pure.vector("u8", encodeItemName(itemName)),
      transaction.pure.u64(basePriceUsdCents),
      transaction.pure.u64(stock),
      transaction.pure.option("address", spotlightDiscountId ?? null),
      transaction.object(ownerCapId)
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
    arguments: [shopArgument, listingArgument, transaction.object(ownerCapId)]
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
      listingArgument,
      transaction.pure.u64(newStock),
      transaction.object(ownerCapId)
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
      listingArgument,
      templateArgument,
      transaction.object(ownerCapId)
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
    arguments: [shopArgument, listingArgument, transaction.object(ownerCapId)]
  })

  return transaction
}
