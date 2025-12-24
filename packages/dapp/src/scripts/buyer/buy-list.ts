/**
 * Lists ShopItem receipt objects owned by an address and prints their related listing details.
 * On Sui, purchases mint an owned receipt object, so you query ownership instead of reading a mapping.
 * If you come from EVM, think of this as a transferable, NFT-like proof of purchase rather than a log event.
 * The shared Shop object is used only for lookup; the receipts themselves live in the buyer account.
 */
import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getItemListingDetails } from "@sui-oracle-market/domain-core/models/item-listing"
import { getShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { type SuiNetworkConfig } from "@sui-oracle-market/tooling-node/config"
import {
  logKeyValueBlue,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logEmptyList,
  logShopItemReceiptSummary
} from "../../utils/log-summaries.ts"

type ListPurchasesArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
}

type NormalizedInputs = {
  ownerAddress: string
  shopPackageId: string
  shopId?: string
}

runSuiScript(
  async (tooling, cliArguments: ListPurchasesArguments) => {
    const inputs = await resolveInputs(
      cliArguments,
      tooling.network.networkName,
      tooling.network
    )
    const suiClient = tooling.suiClient

    logListContext({
      ownerAddress: inputs.ownerAddress,
      packageId: inputs.shopPackageId,
      shopId: inputs.shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const shopItemReceipts = await getShopItemReceiptSummaries({
      ownerAddress: inputs.ownerAddress,
      shopPackageId: inputs.shopPackageId,
      shopFilterId: inputs.shopId,
      suiClient
    })

    if (shopItemReceipts.length === 0)
      return logEmptyList("Purchased-items", "No ShopItem receipts found.")

    const listingDetails = await getListingDetailsForReceipts(
      shopItemReceipts,
      suiClient
    )

    shopItemReceipts.forEach((shopItem, index) =>
      logShopItemReceiptSummary(shopItem, index + 1, listingDetails[index])
    )
  },
  yargs()
    .option("address", {
      alias: ["owner", "owner-address"],
      type: "string",
      description:
        "Address whose ShopItem receipts to list. Defaults to the configured account.",
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
      description:
        "Optional Shop object ID to filter receipts by shop address.",
      demandOption: false
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ListPurchasesArguments,
  networkName: string,
  networkConfig: SuiNetworkConfig
): Promise<NormalizedInputs> => {
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  const shopPackageId = normalizeIdOrThrow(
    cliArguments.shopPackageId ?? shopArtifact?.packageId,
    "A shop package id is required; publish the package or provide --shop-package-id."
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

const getListingDetailsForReceipts = async (
  shopItemReceipts: Awaited<ReturnType<typeof getShopItemReceiptSummaries>>,
  suiClient: SuiClient
) => {
  const listingDetailResults = await Promise.allSettled(
    shopItemReceipts.map((receipt) =>
      getItemListingDetails(
        receipt.shopAddress,
        receipt.itemListingAddress,
        suiClient
      )
    )
  )

  return listingDetailResults.map((result, index) => {
    if (result.status === "fulfilled") return result.value

    logWarning(
      `Unable to fetch listing ${shopItemReceipts[index].itemListingAddress}: ${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`
    )

    return undefined
  })
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
