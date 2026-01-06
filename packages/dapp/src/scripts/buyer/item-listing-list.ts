/**
 * Lists ItemListing objects for a Shop by enumerating dynamic-field markers.
 * Listings are shared objects with their own IDs and versions.
 * Read-only: no transaction is executed.
 */
import yargs from "yargs"

import { getItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"
import {
  logEmptyList,
  logItemListingSummary
} from "../../utils/log-summaries.ts"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

type ListItemListingsArguments = {
  shopId?: string
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: ListItemListingsArguments) => {
    const shopId = await resolveShopIdOrLatest(
      cliArguments.shopId,
      tooling.network.networkName
    )

    const itemListings = await getItemListingSummaries(
      shopId,
      tooling.suiClient
    )
    if (
      emitJsonOutput(
        {
          shopId,
          itemListings
        },
        cliArguments.json
      )
    )
      return

    logListContextWithHeader(
      {
        shopId,
        rpcUrl: tooling.network.url,
        networkName: tooling.network.networkName
      },
      { label: "Item-listings", count: itemListings.length }
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
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
