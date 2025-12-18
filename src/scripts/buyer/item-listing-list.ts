import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { fetchItemListingSummaries } from "../../models/item-listing.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import { logKeyValueBlue } from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  logEmptyList,
  logItemListingSummary
} from "../../utils/log-summaries.ts"

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
    const suiClient = new SuiClient({ url: network.url })

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
