/**
 * Lists DiscountTicket objects owned by an address and prints their details.
 * Tickets are address-owned objects, so possession is the source of truth (not a mapping).
 * Optionally filters by Shop ID and resolves template metadata.
 */
import yargs from "yargs"

import {
  getDiscountTicketSummaries,
  type DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { type SuiNetworkConfig } from "@sui-oracle-market/tooling-node/config"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import {
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"

type ListDiscountTicketsArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
  json?: boolean
}

type NormalizedInputs = {
  ownerAddress: string
  shopPackageId: string
  shopId?: string
}

type DiscountTicketSummary = DiscountTicketDetails

runSuiScript(
  async (tooling, cliArguments) => {
    const {
      suiConfig: { network, currentNetwork }
    } = tooling
    const inputs = await resolveInputs(
      cliArguments,
      network.networkName,
      network
    )

    const discountTickets = await getDiscountTicketSummaries({
      ownerAddress: inputs.ownerAddress,
      shopPackageId: inputs.shopPackageId,
      shopFilterId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    if (
      emitJsonOutput(
        {
          ownerAddress: inputs.ownerAddress,
          shopPackageId: inputs.shopPackageId,
          shopId: inputs.shopId,
          discountTickets
        },
        cliArguments.json
      )
    )
      return

    logListContextWithHeader(
      {
        ownerAddress: inputs.ownerAddress,
        packageId: inputs.shopPackageId,
        shopId: inputs.shopId,
        rpcUrl: network.url,
        networkName: currentNetwork,
        shopLabel: "Shop-filter"
      },
      { label: "Discount-tickets", count: discountTickets.length }
    )

    if (discountTickets.length === 0)
      return logKeyValueYellow("Discount-tickets")(
        "No DiscountTicket objects found."
      )

    discountTickets.forEach((ticket, index) =>
      logDiscountTicket(ticket, index + 1)
    )
  },
  yargs()
    .option("address", {
      alias: ["owner", "owner-address"],
      type: "string",
      description: "Address to inspect; defaults to the configured account."
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; defaults to the latest artifact when omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description: "Optional Shop object ID to filter by shop address."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ListDiscountTicketsArguments,
  networkName: string,
  networkConfig: SuiNetworkConfig
): Promise<NormalizedInputs> => {
  const shopArtifact =
    await getLatestObjectFromArtifact("shop::Shop")(networkName)

  const shopPackageId = cliArguments.shopPackageId || shopArtifact?.packageId

  if (!shopPackageId)
    throw new Error(
      "A shop package id is required and was not found in the object.network.json artifact please enter one as cli argument"
    )

  return {
    ownerAddress: await resolveOwnerAddress(
      cliArguments.address,
      networkConfig
    ),
    shopPackageId,
    shopId: cliArguments.shopId
      ? normalizeIdOrThrow(cliArguments.shopId, "Invalid shop id provided.")
      : undefined
  }
}

const logDiscountTicket = (
  discountTicket: DiscountTicketSummary,
  index: number
) => {
  logKeyValueGreen("Ticket")(index)
  logKeyValueGreen("Object")(discountTicket.discountTicketId)
  logKeyValueGreen("Template")(discountTicket.discountTemplateId)
  logKeyValueGreen("Shop")(discountTicket.shopId)
  logKeyValueGreen("Claimer")(discountTicket.claimer)
  if (discountTicket.listingId)
    logKeyValueGreen("Listing")(discountTicket.listingId)
  else logKeyValueGreen("Listing")("Applies to any listing")
  console.log("")
}
