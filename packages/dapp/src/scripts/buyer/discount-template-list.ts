import yargs from "yargs"

import { fetchDiscountTemplateSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logDiscountTemplateSummary,
  logEmptyList
} from "../../utils/log-summaries.js"

type ListDiscountTemplatesArguments = {
  shopId?: string
}

runSuiScript(
  async (
    { network, currentNetwork },
    cliArguments: ListDiscountTemplatesArguments
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

    const discountTemplates = await fetchDiscountTemplateSummaries(
      shopId,
      suiClient
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
