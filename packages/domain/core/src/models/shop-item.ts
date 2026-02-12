import type { SuiClient, SuiObjectData } from "@mysten/sui/client"

import {
  getAllOwnedObjectsByFilter,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  formatOptionalNumericValue,
  readMoveStringOrVector
} from "@sui-oracle-market/tooling-core/utils/formatters"
import { formatTypeNameFromFieldValue } from "@sui-oracle-market/tooling-core/utils/type-name"

export const SHOP_ITEM_TYPE_FRAGMENT = "::shop::ShopItem"

type CreatedObjectLike = {
  objectType?: string | null
  objectId?: string | null
}

export const findCreatedShopItemIds = (createdObjects: CreatedObjectLike[]) =>
  createdObjects
    .filter((object) => object.objectType?.includes(SHOP_ITEM_TYPE_FRAGMENT))
    .map((object) => object.objectId)
    .filter((objectId): objectId is string => Boolean(objectId))

export type ShopItemReceiptSummary = {
  shopItemId: string
  shopAddress: string
  itemListingAddress: string
  itemType: string
  name?: string
  acquiredAt?: string
}

export const getShopItemReceiptSummaries = async ({
  ownerAddress,
  shopPackageId,
  shopFilterId,
  suiClient
}: {
  ownerAddress: string
  shopPackageId: string
  shopFilterId?: string
  suiClient: SuiClient
}): Promise<ShopItemReceiptSummary[]> => {
  const ownedObjects = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: {
        MoveModule: {
          package: shopPackageId,
          module: "shop"
        }
      },
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const shopItemReceipts = ownedObjects
    .filter((object) => object.type?.includes(SHOP_ITEM_TYPE_FRAGMENT))
    .map((object) => parseShopItemReceiptFromObject(object))

  if (!shopFilterId) return shopItemReceipts

  const normalizedShopFilterId = normalizeIdOrThrow(
    shopFilterId,
    "Invalid shop id provided for filtering."
  )

  return shopItemReceipts.filter(
    (receipt) => receipt.shopAddress === normalizedShopFilterId
  )
}

export const parseShopItemReceiptFromObject = (
  shopItemObject: SuiObjectData
): ShopItemReceiptSummary => {
  const shopItemId = normalizeIdOrThrow(
    shopItemObject.objectId,
    "ShopItem object is missing an id."
  )
  const shopItemFields = unwrapMoveObjectFields<{
    shop_address?: unknown
    shop_id?: unknown
    item_listing_id: unknown
    item_type: unknown
    name: unknown
    acquired_at: unknown
  }>(shopItemObject)

  const shopAddress = normalizeIdOrThrow(
    normalizeOptionalIdFromValue(
      shopItemFields.shop_address ?? shopItemFields.shop_id
    ),
    `Missing shop_id for ShopItem ${shopItemId}.`
  )
  const itemListingAddress = normalizeIdOrThrow(
    normalizeOptionalIdFromValue(shopItemFields.item_listing_id),
    `Missing item_listing_id for ShopItem ${shopItemId}.`
  )
  const itemType =
    formatTypeNameFromFieldValue(shopItemFields.item_type) || "Unknown"

  return {
    shopItemId,
    shopAddress,
    itemListingAddress,
    itemType,
    name: readMoveStringOrVector(shopItemFields.name),
    acquiredAt: formatOptionalNumericValue(shopItemFields.acquired_at)
  }
}
