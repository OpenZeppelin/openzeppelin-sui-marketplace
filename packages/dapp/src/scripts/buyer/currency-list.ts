/**
 * Lists AcceptedCurrency objects registered on a Shop, including the coin type and pricing config.
 * On Sui, each accepted currency is its own object and coin types are Move type tags, not token addresses.
 * If you come from EVM, treat this like reading a registry where each entry has its own object ID.
 * The Shop shared object anchors the registry, but the data lives in separate objects.
 */
import yargs from "yargs"

import { getAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logAcceptedCurrencySummary,
  logEmptyList
} from "../../utils/log-summaries.ts"

type ListCurrenciesArguments = {
  shopId?: string
}

runSuiScript(
  async (tooling, cliArguments: ListCurrenciesArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      tooling.network.networkName
    )

    logListContext({
      shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const acceptedCurrencies = await getAcceptedCurrencySummaries(
      shopId,
      tooling.suiClient
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
