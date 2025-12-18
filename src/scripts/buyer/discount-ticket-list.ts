import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import yargs from "yargs"

import type { DiscountTicketDetails } from "../../models/discount.ts"
import {
  formatDiscountTicketStructType,
  parseDiscountTicketFromObject
} from "../../models/discount.ts"
import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import {
  getAccountConfig,
  type SuiNetworkConfig
} from "../../tooling/config.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import {
  fetchAllOwnedObjectsByType,
  normalizeIdOrThrow
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"

type ListDiscountTicketsArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
}

type NormalizedInputs = {
  ownerAddress: string
  shopPackageId: string
  discountTicketStructType: string
  shopId?: string
}

type DiscountTicketSummary = DiscountTicketDetails

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const inputs = await resolveInputs(
      cliArguments,
      network.networkName,
      network
    )
    const suiClient = new SuiClient({ url: network.url })

    logListContext({
      ownerAddress: inputs.ownerAddress,
      packageId: inputs.shopPackageId,
      shopId: inputs.shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const discountTickets = await fetchDiscountTickets({
      ownerAddress: inputs.ownerAddress,
      discountTicketStructType: inputs.discountTicketStructType,
      shopFilterId: inputs.shopId,
      suiClient
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
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

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
    discountTicketStructType: formatDiscountTicketStructType(shopPackageId),
    shopId: cliArguments.shopId
      ? normalizeIdOrThrow(cliArguments.shopId, "Invalid shop id provided.")
      : undefined
  }
}

const resolveOwnerAddress = async (
  providedAddress: string | undefined,
  networkConfig: SuiNetworkConfig
) => {
  if (providedAddress) return normalizeSuiAddress(providedAddress)

  const accountConfig = getAccountConfig(networkConfig)

  if (accountConfig.accountAddress)
    return normalizeSuiAddress(accountConfig.accountAddress)

  const keypair = await loadKeypair(accountConfig)
  return normalizeSuiAddress(keypair.toSuiAddress())
}

const fetchDiscountTickets = async ({
  ownerAddress,
  discountTicketStructType,
  shopFilterId,
  suiClient
}: {
  ownerAddress: string
  discountTicketStructType: string
  shopFilterId?: string
  suiClient: SuiClient
}): Promise<DiscountTicketSummary[]> => {
  const discountTicketObjects = await fetchAllOwnedObjectsByType(
    {
      ownerAddress,
      structType: discountTicketStructType
    },
    suiClient
  )

  const discountTickets = discountTicketObjects.map(
    parseDiscountTicketFromObject
  )

  if (!shopFilterId) return discountTickets

  const normalizedShopFilterId = normalizeIdOrThrow(
    shopFilterId,
    "Invalid shop id provided for filtering."
  )

  return discountTickets.filter(
    (discountTicket) => discountTicket.shopAddress === normalizedShopFilterId
  )
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
