import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { getItemListingSummary } from "../models/item-listing.ts"
import {
  getSuiObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { normalizeBigIntFromMoveValue } from "@sui-oracle-market/tooling-core/utils/move-values"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"

type DiscountTemplateMetadata = {
  id: string
  shopId: string
  appliesToListing?: string
}

const normalizeListingIdFromMoveValue = (value: unknown) => {
  const parsedListingId = normalizeBigIntFromMoveValue(value)
  if (parsedListingId === undefined || parsedListingId < 0n) return undefined
  return parsedListingId.toString()
}

const normalizeListingIdInput = (listingId: string, label: string) =>
  parseNonNegativeU64(listingId, label).toString()

export const getDiscountTemplateMetadata = async (
  templateId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateMetadata> => {
  const { object } = await getSuiObject(
    {
      objectId: templateId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const fields = unwrapMoveObjectFields(object)
  const templateShopId = normalizeOptionalIdFromValue(
    fields.shop_address ?? fields.shop_id
  )
  if (!templateShopId)
    throw new Error(
      `Discount template ${templateId} is missing a shop address field.`
    )

  return {
    id:
      normalizeOptionalIdFromValue(fields.id) ??
      normalizeSuiObjectId(templateId),
    shopId: templateShopId,
    appliesToListing: normalizeListingIdFromMoveValue(fields.applies_to_listing)
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
  const [listingId, template] = await Promise.all([
    resolveListingIdForShop({ shopId, itemListingId, suiClient }),
    getDiscountTemplateMetadata(discountTemplateId, suiClient)
  ])

  const normalizedShopId = normalizeSuiObjectId(shopId)

  if (template.shopId !== normalizedShopId)
    throw new Error(
      `Discount template ${template.id} belongs to shop ${template.shopId}, not ${normalizedShopId}.`
    )

  if (template.appliesToListing && template.appliesToListing !== listingId)
    throw new Error(
      `Discount template ${template.id} is pinned to listing ${template.appliesToListing} and cannot be attached to ${listingId}. Create a template for this listing or use the pinned listing.`
    )

  return {
    itemListingId: listingId,
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
  const normalizedListingId = normalizeListingIdInput(
    itemListingId,
    "itemListingId"
  )

  await getItemListingSummary(shopId, normalizedListingId, suiClient)
  return normalizedListingId
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
  itemListingId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  ownerCapId: string
  itemListingId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingId = normalizeListingIdInput(itemListingId, "itemListingId")

  transaction.moveCall({
    target: `${packageId}::shop::remove_item_listing`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.u64(BigInt(listingId))
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
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingId = normalizeListingIdInput(itemListingId, "itemListingId")

  transaction.moveCall({
    target: `${packageId}::shop::update_item_listing_stock`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.u64(BigInt(listingId)),
      transaction.pure.u64(newStock)
    ]
  })

  return transaction
}

export const buildAttachDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListingId,
  discountTemplate,
  ownerCapId
}: {
  packageId: string
  shop: WrappedSuiSharedObject
  itemListingId: string
  discountTemplate: WrappedSuiSharedObject
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const templateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )
  const listingId = normalizeListingIdInput(itemListingId, "itemListingId")

  transaction.moveCall({
    target: `${packageId}::shop::attach_template_to_listing`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.u64(BigInt(listingId)),
      templateArgument
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
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingId = normalizeListingIdInput(itemListingId, "itemListingId")

  transaction.moveCall({
    target: `${packageId}::shop::clear_template_from_listing`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.u64(BigInt(listingId))
    ]
  })

  return transaction
}
