import yargs from "yargs"

import { fetchAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logAcceptedCurrencySummary,
  logEmptyList
} from "../../utils/log-summaries.js"

type ListCurrenciesArguments = {
  shopId?: string
}

runSuiScript(
  async (
    { network, currentNetwork },
    cliArguments: ListCurrenciesArguments
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

    const acceptedCurrencies = await fetchAcceptedCurrencySummaries(
      shopId,
      suiClient
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
