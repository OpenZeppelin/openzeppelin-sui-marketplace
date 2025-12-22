import yargs from "yargs"

import { getDiscountTemplateSummaries } from "@sui-oracle-market/domain-core/models/discount"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueBlue } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logDiscountTemplateSummary,
  logEmptyList
} from "../../utils/log-summaries.ts"

type ListDiscountTemplatesArguments = {
  shopId?: string
}

runSuiScript(
  async (tooling, cliArguments: ListDiscountTemplatesArguments) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      tooling.network.networkName
    )

    logListContext({
      shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const discountTemplates = await getDiscountTemplateSummaries(
      shopId,
      tooling.suiClient
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
