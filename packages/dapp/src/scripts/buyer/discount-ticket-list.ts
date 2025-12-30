/**
 * Lists DiscountTicket objects owned by an address and prints their on-chain details.
 * Tickets are owned objects in Sui, so "having a coupon" means holding an object, not a balance in a contract.
 * If you come from EVM, this is closer to an NFT coupon than a mapping entry, and ownership is the source of truth.
 * The script derives the ticket type from the package ID and can filter by an optional Shop ID.
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
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type ListDiscountTicketsArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
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

    logListContext({
      ownerAddress: inputs.ownerAddress,
      packageId: inputs.shopPackageId,
      shopId: inputs.shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const discountTickets = await getDiscountTicketSummaries({
      ownerAddress: inputs.ownerAddress,
      shopPackageId: inputs.shopPackageId,
      shopFilterId: inputs.shopId,
      suiClient: tooling.suiClient
    })

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
      description:
        "Address whose discount tickets to list. Defaults to the configured account.",
      demandOption: false
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest Shop artifact when omitted.",
      demandOption: false
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description: "Optional Shop object ID to filter tickets by shop address.",
      demandOption: false
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

const logListContext = ({
  ownerAddress,
  packageId,
  shopId,
  rpcUrl,
  networkName
}: {
  ownerAddress: string
  packageId: string
  shopId?: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Owner")(ownerAddress)
  logKeyValueBlue("Package")(packageId)
  if (shopId) logKeyValueBlue("Shop-filter")(shopId)
  console.log("")
}

const logDiscountTicket = (
  discountTicket: DiscountTicketSummary,
  index: number
) => {
  logKeyValueGreen("Ticket")(index)
  logKeyValueGreen("Object")(discountTicket.discountTicketId)
  logKeyValueGreen("Template")(discountTicket.discountTemplateId)
  logKeyValueGreen("Shop")(discountTicket.shopAddress)
  logKeyValueGreen("Claimer")(discountTicket.claimer)
  if (discountTicket.listingId)
    logKeyValueGreen("Listing")(discountTicket.listingId)
  else logKeyValueGreen("Listing")("Applies to any listing")
  console.log("")
}
