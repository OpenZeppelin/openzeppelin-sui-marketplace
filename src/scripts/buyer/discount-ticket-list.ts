import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

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
  fetchAllOwnedObjects,
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"

type ListDiscountTicketsArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
}

type NormalizedInputs = {
  ownerAddress: string
  packageId: string
  shopId?: string
}

type DiscountTicketSummary = {
  discountTicketId: string
  discountTemplateId: string
  shopAddress: string
  listingId?: string
  claimer: string
}

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
      packageId: inputs.packageId,
      shopId: inputs.shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const discountTickets = await fetchDiscountTickets({
      ownerAddress: inputs.ownerAddress,
      packageId: inputs.packageId,
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
): Promise<NormalizedInputs> => ({
  ownerAddress: await resolveOwnerAddress(cliArguments.address, networkConfig),
  packageId: await resolveShopPackageId(
    cliArguments.shopPackageId,
    networkName
  ),
  shopId: cliArguments.shopId
    ? normalizeSuiObjectId(
        normalizeIdOrThrow(cliArguments.shopId, "Invalid shop id provided.")
      )
    : undefined
})

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

const resolveShopPackageId = async (
  shopPackageId: string | undefined,
  networkName: string
): Promise<string> => {
  if (shopPackageId) return normalizeSuiObjectId(shopPackageId)

  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  return normalizeIdOrThrow(
    shopArtifact?.packageId,
    "A shop package id is required; publish the package first or provide --shop-package-id."
  )
}

const fetchDiscountTickets = async ({
  ownerAddress,
  packageId,
  shopFilterId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  shopFilterId?: string
  suiClient: SuiClient
}): Promise<DiscountTicketSummary[]> => {
  const discountTicketObjects = await fetchAllOwnedObjects(
    {
      ownerAddress,
      discountTicketType: `${packageId}::shop::DiscountTicket`
    },
    suiClient
  )

  const discountTickets = discountTicketObjects.map(buildDiscountTicketSummary)

  if (!shopFilterId) return discountTickets

  const normalizedShopFilterId = normalizeSuiObjectId(shopFilterId)
  return discountTickets.filter(
    (discountTicket) => discountTicket.shopAddress === normalizedShopFilterId
  )
}

const buildDiscountTicketSummary = (
  discountTicketObject: SuiObjectData
): DiscountTicketSummary => {
  const discountTicketFields = unwrapMoveObjectFields<{
    discount_template_id: string
    shop_address: string
    claimer: string
    listing_id: string | undefined
  }>(discountTicketObject)

  const discountTicketId = normalizeIdOrThrow(
    discountTicketObject.objectId,
    "DiscountTicket object is missing an id."
  )

  const discountTemplateId = normalizeIdOrThrow(
    normalizeOptionalIdFromValue(discountTicketFields.discount_template_id),
    `Missing discount_template_id for DiscountTicket ${discountTicketId}.`
  )

  const shopAddress = normalizeIdOrThrow(
    normalizeOptionalIdFromValue(discountTicketFields.shop_address),
    `Missing shop_address for DiscountTicket ${discountTicketId}.`
  )

  const listingId = normalizeOptionalIdFromValue(
    discountTicketFields.listing_id
  )

  const claimer = normalizeIdOrThrow(
    normalizeOptionalAddress(discountTicketFields.claimer),
    `Missing claimer for DiscountTicket ${discountTicketId}.`
  )

  return {
    discountTicketId,
    discountTemplateId,
    shopAddress,
    listingId: listingId ? normalizeSuiObjectId(listingId) : undefined,
    claimer
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
