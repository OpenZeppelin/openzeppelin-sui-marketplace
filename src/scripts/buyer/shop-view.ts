import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"
import { fetchAcceptedCurrencySummaries } from "../../models/currency.ts"
import { fetchDiscountTemplateSummaries } from "../../models/discount.ts"
import { fetchItemListingSummaries } from "../../models/item-listing.ts"
import {
  fetchShopOverview,
  resolveLatestArtifactShopId
} from "../../models/shop.ts"
import { logKeyValueBlue } from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  logAcceptedCurrencySummary,
  logDiscountTemplateSummary,
  logEmptyList,
  logItemListingSummary,
  logShopOverview
} from "../../utils/log-summaries.ts"

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

    if (itemListings.length === 0)
      logEmptyList("Item-listings", "No listings found.")
    else
      itemListings.forEach((itemListing, index) =>
        logItemListingSummary(itemListing, index + 1)
      )

    if (acceptedCurrencies.length === 0)
      logEmptyList("Accepted-currencies", "No currencies registered.")
    else
      acceptedCurrencies.forEach((acceptedCurrency, index) =>
        logAcceptedCurrencySummary(acceptedCurrency, index + 1)
      )

    if (discountTemplates.length === 0)
      logEmptyList("Discount-templates", "No templates found.")
    else
      discountTemplates.forEach((discountTemplate, index) =>
        logDiscountTemplateSummary(discountTemplate, index + 1)
      )
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
