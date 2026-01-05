/**
 * Lists AcceptedCurrency objects registered on a Shop, including the coin type and pricing config.
 * On Sui, each accepted currency is its own object and coin types are Move type tags, not token addresses.
 * If you come from EVM, treat this like reading a registry where each entry has its own object ID.
 * The Shop shared object anchors the registry, but the data lives in separate objects.
 */
import yargs from "yargs"

import { getAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"
import {
  logAcceptedCurrencySummary,
  logEmptyList
} from "../../utils/log-summaries.ts"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

type ListCurrenciesArguments = {
  shopId?: string
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: ListCurrenciesArguments) => {
    const shopId = await resolveShopIdOrLatest(
      cliArguments.shopId,
      tooling.network.networkName
    )

    const acceptedCurrencies = await getAcceptedCurrencySummaries(
      shopId,
      tooling.suiClient
    )
    if (
      emitJsonOutput(
        {
          shopId,
          acceptedCurrencies
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
      { label: "Accepted-currencies", count: acceptedCurrencies.length }
    )
    if (acceptedCurrencies.length === 0)
      return logEmptyList("Accepted-currencies", "No currencies registered.")

    acceptedCurrencies.forEach((currency, index) =>
      logAcceptedCurrencySummary(currency, index + 1)
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
