import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"
import type { AcceptedCurrencySummary } from "../../models/currency.ts"
import { fetchAcceptedCurrencySummaries } from "../../models/currency.ts"
import type { DiscountTemplateSummary } from "../../models/discount.ts"
import { fetchDiscountTemplateSummaries } from "../../models/discount.ts"
import type { ItemListingSummary } from "../../models/item-listing.ts"
import { fetchItemListingSummaries } from "../../models/item-listing.ts"
import type { ShopOverview } from "../../models/shop.ts"
import {
  fetchShopOverview,
  resolveLatestArtifactShopId
} from "../../models/shop.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"

type ShowShopArguments = {
  shopId?: string
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments: ShowShopArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      network.networkName
    )
    const suiClient = new SuiClient({ url: network.url })

    logContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const [shopOverview, itemListings, acceptedCurrencies, discountTemplates] =
      await Promise.all([
        fetchShopOverview(shopId, suiClient),
        fetchItemListingSummaries(shopId, suiClient),
        fetchAcceptedCurrencySummaries(shopId, suiClient),
        fetchDiscountTemplateSummaries(shopId, suiClient)
      ])

    logShopOverview(shopOverview)
    console.log("")

    logItemListings(itemListings)
    logAcceptedCurrencies(acceptedCurrencies)
    logDiscountTemplates(discountTemplates)
  },
  yargs()
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available.",
      demandOption: false
    })
    .strict()
)

const logContext = ({
  shopId,
  rpcUrl,
  networkName
}: {
  shopId: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Shop")(shopId)
  console.log("")
}

const logShopOverview = ({ shopId, ownerAddress }: ShopOverview) => {
  logKeyValueGreen("Shop")(shopId)
  logKeyValueGreen("Owner")(ownerAddress)
}

const logItemListings = (itemListings: ItemListingSummary[]) => {
  if (itemListings.length === 0) {
    logKeyValueYellow("Item-listings")("No listings found.")
    console.log("")
    return
  }

  itemListings.forEach((itemListing, index) => {
    logKeyValueGreen("Item")(index + 1)
    logKeyValueGreen("Object")(itemListing.itemListingId)
    logKeyValueGreen("Name")(itemListing.name ?? "Unknown")
    logKeyValueGreen("Item-type")(itemListing.itemType)
    logKeyValueGreen("USD-cents")(
      itemListing.basePriceUsdCents ?? "Unknown price"
    )
    logKeyValueGreen("Stock")(itemListing.stock ?? "Unknown stock")
    if (itemListing.spotlightTemplateId)
      logKeyValueGreen("Spotlight")(itemListing.spotlightTemplateId)
    logKeyValueGreen("Marker-id")(itemListing.markerObjectId)
    console.log("")
  })
}

const logAcceptedCurrencies = (
  acceptedCurrencies: AcceptedCurrencySummary[]
) => {
  if (acceptedCurrencies.length === 0) {
    logKeyValueYellow("Accepted-currencies")("No currencies registered.")
    console.log("")
    return
  }

  acceptedCurrencies.forEach((acceptedCurrency, index) => {
    logKeyValueGreen("Currency")(index + 1)
    logKeyValueGreen("Object")(acceptedCurrency.acceptedCurrencyId)
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
    logKeyValueGreen("Max-status-lag")(
      acceptedCurrency.maxPriceStatusLagSecsCap ?? "module default"
    )
    logKeyValueGreen("Marker-id")(acceptedCurrency.markerObjectId)
    console.log("")
  })
}

const logDiscountTemplates = (discountTemplates: DiscountTemplateSummary[]) => {
  if (discountTemplates.length === 0) {
    logKeyValueYellow("Discount-templates")("No templates found.")
    return
  }

  discountTemplates.forEach((discountTemplate, index) => {
    logKeyValueGreen("Template")(index + 1)
    logKeyValueGreen("Object")(discountTemplate.discountTemplateId)
    logKeyValueGreen("Status")(discountTemplate.status)
    logKeyValueGreen("Active-flag")(discountTemplate.activeFlag)
    logKeyValueGreen("Shop")(discountTemplate.shopAddress)
    if (discountTemplate.appliesToListingId)
      logKeyValueGreen("Listing")(discountTemplate.appliesToListingId)
    else logKeyValueGreen("Listing")("Reusable across listings")
    logKeyValueGreen("Rule")(discountTemplate.ruleDescription)
    logKeyValueGreen("Starts-at")(discountTemplate.startsAt ?? "Unknown start")
    if (discountTemplate.expiresAt)
      logKeyValueGreen("Expires-at")(discountTemplate.expiresAt)
    else logKeyValueGreen("Expires-at")("No expiry")
    if (discountTemplate.maxRedemptions)
      logKeyValueGreen("Max-redemptions")(discountTemplate.maxRedemptions)
    else logKeyValueGreen("Max-redemptions")("Unlimited")
    logKeyValueGreen("Claims")(discountTemplate.claimsIssued ?? "Unknown")
    logKeyValueGreen("Redeemed")(discountTemplate.redemptions ?? "Unknown")
    logKeyValueGreen("Marker-id")(discountTemplate.markerObjectId)
    console.log("")
  })
}
