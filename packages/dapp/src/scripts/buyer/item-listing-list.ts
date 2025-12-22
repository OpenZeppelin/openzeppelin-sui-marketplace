import yargs from "yargs"

import { getItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logEmptyList,
  logItemListingSummary
} from "../../utils/log-summaries.ts"

type ListItemListingsArguments = {
  shopId?: string
}

runSuiScript(
  async (tooling, cliArguments: ListItemListingsArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      tooling.network.networkName
    )

    logListContext({
      shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const itemListings = await getItemListingSummaries(
      shopId,
      tooling.suiClient
    )
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
