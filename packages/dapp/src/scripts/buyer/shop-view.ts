import { getAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import { getDiscountTemplateSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { getItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import yargs from "yargs"
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
  async (tooling, cliArguments: ShowShopArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      tooling.network.networkName
    )
    const suiClient = tooling.suiClient

    logContext({
      shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const [shopOverview, itemListings, acceptedCurrencies, discountTemplates] =
      await Promise.all([
        getShopOverview(shopId, suiClient),
        getItemListingSummaries(shopId, suiClient),
        getAcceptedCurrencySummaries(shopId, suiClient),
        getDiscountTemplateSummaries(shopId, suiClient)
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
