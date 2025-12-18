import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import type { ItemListingSummary } from "../../models/item-listing.ts"
import { fetchItemListingSummaries } from "../../models/item-listing.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"

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
    if (itemListings.length === 0) {
      logKeyValueYellow("Item-listings")("No listings found.")
      return
    }

    itemListings.forEach(logItemListing)
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

const logItemListing = (itemListing: ItemListingSummary, index: number) => {
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
}
