import yargs from "yargs"

import { fetchItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logEmptyList,
  logItemListingSummary
} from "../../utils/log-summaries.js"

type ListItemListingsArguments = {
  shopId?: string
}

runSuiScript(
  async (
    { network, currentNetwork },
    cliArguments: ListItemListingsArguments
  ) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      network.networkName
    )
    const suiClient = createSuiClient(network.url)

    logListContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const itemListings = await fetchItemListingSummaries(shopId, suiClient)
    if (itemListings.length === 0)
      return logEmptyList("Item-listings", "No listings found.")

    itemListings.forEach((listing, index) =>
      logItemListingSummary(listing, index + 1)
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

const logListContext = ({
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
