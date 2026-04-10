/**
 * Fetches Discount objects for a Shop so buyers can see current offers.
 * Discounts are table-backed entries stored under the shared Shop.
 * Read-only: no transaction is submitted.
 */
import yargs from "yargs"

import { getDiscountSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"
import { logDiscountSummary, logEmptyList } from "../../utils/log-summaries.ts"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

type ListDiscountsArguments = {
  shopId?: string
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: ListDiscountsArguments) => {
    const shopId = await resolveShopIdOrLatest(
      cliArguments.shopId,
      tooling.network.networkName
    )

    const discounts = await getDiscountSummaries(shopId, tooling.suiClient)
    if (
      emitJsonOutput(
        {
          shopId,
          discounts
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
      { label: "Discounts", count: discounts.length }
    )
    if (discounts.length === 0)
      return logEmptyList("Discounts", "No discounts found.")

    discounts.forEach((discount, index) =>
      logDiscountSummary(discount, index + 1)
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
