import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type { DiscountSummary } from "@sui-oracle-market/domain-core/models/discount"
import type {
  ItemListingDetails,
  ItemListingSummary
} from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import {
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"

export const logShopOverview = ({
  shopId,
  ownerAddress,
  name,
  disabled
}: ShopOverview) => {
  logKeyValueGreen("Shop")(shopId)
  logKeyValueGreen("Name")(name ?? "Unknown")
  logKeyValueGreen("Owner")(ownerAddress)
  logKeyValueGreen("Disabled")(disabled ? "Yes" : "No")
  console.log("")
}

export const logItemListingSummary = (
  itemListing: ItemListingSummary,
  index?: number
) => {
  if (index !== undefined) logKeyValueGreen("Item")(index)
  logKeyValueGreen("Listing-id")(itemListing.itemListingId)
  logKeyValueGreen("Name")(itemListing.name ?? "Unknown")
  logKeyValueGreen("Item-type")(itemListing.itemType)
  logKeyValueGreen("USD-cents")(
    itemListing.basePriceUsdCents ?? "Unknown price"
  )
  logKeyValueGreen("Stock")(itemListing.stock ?? "Unknown stock")
  if (itemListing.spotlightDiscountId)
    logKeyValueGreen("Spotlight")(itemListing.spotlightDiscountId)
  logKeyValueGreen("Table-entry-field")(itemListing.tableEntryFieldId)
  console.log("")
}

export const logAcceptedCurrencySummary = (
  acceptedCurrency: AcceptedCurrencySummary,
  index?: number
) => {
  if (index !== undefined) logKeyValueGreen("Currency")(index)
  logKeyValueGreen("Table-entry-field")(acceptedCurrency.tableEntryFieldId)
  logKeyValueGreen("Coin-type")(acceptedCurrency.coinType)
  if (acceptedCurrency.symbol)
    logKeyValueGreen("Symbol")(acceptedCurrency.symbol)
  if (acceptedCurrency.decimals !== undefined)
    logKeyValueGreen("Decimals")(acceptedCurrency.decimals)
  logKeyValueGreen("Feed-id")(acceptedCurrency.feedIdHex)
  if (acceptedCurrency.pythObjectId)
    logKeyValueGreen("Pyth-object")(acceptedCurrency.pythObjectId)
  logKeyValueGreen("Max-age-secs")(
    acceptedCurrency.maxPriceAgeSecsCap ?? "module default"
  )
  logKeyValueGreen("Max-conf-bps")(
    acceptedCurrency.maxConfidenceRatioBpsCap ?? "module default"
  )
  console.log("")
}

export const logDiscountSummary = (
  discount: DiscountSummary,
  index?: number
) => {
  if (index !== undefined) logKeyValueGreen("Template")(index)
  logKeyValueGreen("Object")(discount.discountId)
  logKeyValueGreen("Status")(discount.status)
  logKeyValueGreen("Active-flag")(discount.activeFlag)
  logKeyValueGreen("Shop")(discount.shopId)
  if (discount.appliesToListingId)
    logKeyValueGreen("Listing")(discount.appliesToListingId)
  else logKeyValueGreen("Listing")("Reusable across listings")
  logKeyValueGreen("Rule")(discount.ruleDescription)
  logKeyValueGreen("Starts-at")(discount.startsAt ?? "Unknown start")
  if (discount.expiresAt) logKeyValueGreen("Expires-at")(discount.expiresAt)
  else logKeyValueGreen("Expires-at")("No expiry")
  if (discount.maxRedemptions)
    logKeyValueGreen("Max-redemptions")(discount.maxRedemptions)
  else logKeyValueGreen("Max-redemptions")("Unlimited")
  logKeyValueGreen("Redeemed")(discount.redemptions ?? "Unknown")
  logKeyValueGreen("Table-entry-field")(discount.tableEntryFieldId)
  console.log("")
}

export const logShopItemReceiptSummary = (
  shopItem: ShopItemReceiptSummary,
  index?: number,
  listingDetails?: ItemListingDetails
) => {
  if (index !== undefined) logKeyValueGreen("Receipt")(index)
  logKeyValueGreen("Object")(shopItem.shopItemId)
  logKeyValueGreen("Shop")(shopItem.shopId)
  logKeyValueGreen("Listing-id")(shopItem.listingId)
  logKeyValueGreen("Receipt-name")(shopItem.name ?? "Unknown")
  logKeyValueGreen("Receipt-type")(shopItem.itemType)
  logKeyValueGreen("Acquired-at")(shopItem.acquiredAt ?? "Unknown")
  if (listingDetails) {
    logKeyValueGreen("Listing-name")(listingDetails.name ?? "Unknown")
    logKeyValueGreen("Listing-type")(listingDetails.itemType)
    logKeyValueGreen("Listing-price")(
      listingDetails.basePriceUsdCents ?? "Unknown price"
    )
    logKeyValueGreen("Listing-stock")(listingDetails.stock ?? "Unknown stock")
    if (listingDetails.spotlightDiscountId)
      logKeyValueGreen("Listing-spotlight")(listingDetails.spotlightDiscountId)
    logKeyValueGreen("Listing-table-entry")(
      listingDetails.tableEntryFieldId ?? "Not listed"
    )
  }
  console.log("")
}

export const logEmptyList = (label: string, message: string) =>
  logKeyValueYellow(label)(message)
