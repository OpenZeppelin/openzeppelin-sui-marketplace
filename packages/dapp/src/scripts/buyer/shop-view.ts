import { fetchAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import { fetchDiscountTemplateSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { fetchItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import { fetchShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import yargs from "yargs"
import {
  logAcceptedCurrencySummary,
  logDiscountTemplateSummary,
  logEmptyList,
  logItemListingSummary,
  logShopOverview
} from "../../utils/log-summaries.js"

type ShowShopArguments = {
  shopId?: string
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments: ShowShopArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      network.networkName
    )
    const suiClient = createSuiClient(network.url)

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
