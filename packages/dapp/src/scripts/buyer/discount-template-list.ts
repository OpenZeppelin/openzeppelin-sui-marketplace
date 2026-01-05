/**
 * Fetches DiscountTemplate objects for a Shop so buyers can see available offers.
 * Sui keeps mutable shared state in shared objects, while templates are separate objects referenced by the Shop.
 * If you come from EVM, this replaces reading a single contract storage map with querying objects by type/id.
 * This script is read-only and does not submit a transaction.
 */
import yargs from "yargs"

import { getDiscountTemplateSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"
import {
  logDiscountTemplateSummary,
  logEmptyList
} from "../../utils/log-summaries.ts"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

type ListDiscountTemplatesArguments = {
  shopId?: string
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: ListDiscountTemplatesArguments) => {
    const shopId = await resolveShopIdOrLatest(
      cliArguments.shopId,
      tooling.network.networkName
    )

    const discountTemplates = await getDiscountTemplateSummaries(
      shopId,
      tooling.suiClient
    )
    if (
      emitJsonOutput(
        {
          shopId,
          discountTemplates
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
      { label: "Discount-templates", count: discountTemplates.length }
    )
    if (discountTemplates.length === 0)
      return logEmptyList("Discount-templates", "No templates found.")

    discountTemplates.forEach((template, index) =>
      logDiscountTemplateSummary(template, index + 1)
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
