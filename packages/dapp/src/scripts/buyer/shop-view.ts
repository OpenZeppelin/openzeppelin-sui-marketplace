/**
 * Displays a full Shop overview: core metadata, listings, accepted currencies, and discount templates.
 * In Sui, these pieces are separate objects referenced from a shared Shop object, not a single storage blob.
 * If you come from EVM, you will see multiple object reads instead of one contract call, which maps to Sui's model.
 * The script is read-only and combines results into a human-friendly snapshot.
 */
import { getShopSnapshot } from "@sui-oracle-market/domain-core/models/shop"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import yargs from "yargs"
import { logListContextWithHeader } from "../../utils/context.ts"
import {
  logAcceptedCurrencySummary,
  logDiscountTemplateSummary,
  logEmptyList,
  logItemListingSummary,
  logShopOverview
} from "../../utils/log-summaries.ts"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

runSuiScript(
  async (tooling, cliArguments: { shopId?: string; json?: boolean }) => {
    const shopId = await resolveShopIdOrLatest(
      cliArguments.shopId,
      tooling.network.networkName
    )

    const {
      shopOverview,
      itemListings,
      acceptedCurrencies,
      discountTemplates
    } = await getShopSnapshot(shopId, tooling.suiClient)

    if (
      emitJsonOutput(
        {
          shopOverview,
          itemListings,
          acceptedCurrencies,
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
      { label: "Shop-snapshot" }
    )

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
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
