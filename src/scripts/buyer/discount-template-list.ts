import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import type { DiscountTemplateSummary } from "../../models/discount.ts"
import { fetchDiscountTemplateSummaries } from "../../models/discount.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"

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
      return logKeyValueYellow("Discount-templates")("No templates found.")

    discountTemplates.forEach((template, index) =>
      logDiscountTemplate(template, index + 1)
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

const logDiscountTemplate = (
  discountTemplate: DiscountTemplateSummary,
  index: number
) => {
  logKeyValueGreen("Template")(index)
  logKeyValueGreen("Object")(discountTemplate.discountTemplateId)
  logKeyValueGreen("Status")(discountTemplate.status)
  logKeyValueGreen("Active-flag")(discountTemplate.activeFlag)
  logKeyValueGreen("Shop")(discountTemplate.shopAddress)
  if (discountTemplate.appliesToListingId)
    logKeyValueGreen("Listing")(discountTemplate.appliesToListingId)
  else logKeyValueGreen("Listing")("Reusable across listings")
  logKeyValueGreen("Rule")(discountTemplate.ruleDescription)
  logKeyValueGreen("Starts-at")(discountTemplate.startsAt ?? "Unknown start")
  if (discountTemplate.expiresAt)
    logKeyValueGreen("Expires-at")(discountTemplate.expiresAt)
  else logKeyValueGreen("Expires-at")("No expiry")
  if (discountTemplate.maxRedemptions)
    logKeyValueGreen("Max-redemptions")(discountTemplate.maxRedemptions)
  else logKeyValueGreen("Max-redemptions")("Unlimited")
  logKeyValueGreen("Claims")(discountTemplate.claimsIssued ?? "Unknown")
  logKeyValueGreen("Redeemed")(discountTemplate.redemptions ?? "Unknown")
  logKeyValueGreen("Marker-id")(discountTemplate.markerObjectId)
  console.log("")
}
