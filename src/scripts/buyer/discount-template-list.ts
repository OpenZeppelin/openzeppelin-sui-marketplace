import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { fetchDiscountTemplateSummaries } from "../../models/discount.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import { logKeyValueBlue } from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  logDiscountTemplateSummary,
  logEmptyList
} from "../../utils/log-summaries.ts"

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
    const suiClient = new SuiClient({ url: network.url })

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
