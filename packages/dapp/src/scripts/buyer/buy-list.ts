import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getItemListingDetails } from "@sui-oracle-market/domain-core/models/item-listing"
import { fetchShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { type SuiNetworkConfig } from "@sui-oracle-market/tooling-node/config"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import {
  logKeyValueBlue,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logEmptyList,
  logShopItemReceiptSummary
} from "../../utils/log-summaries.js"

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
  async ({ network, currentNetwork }, cliArguments: ListPurchasesArguments) => {
    const inputs = await resolveInputs(
      cliArguments,
      network.networkName,
      network
    )
    const suiClient = createSuiClient(network.url)

    logListContext({
      ownerAddress: inputs.ownerAddress,
      packageId: inputs.shopPackageId,
      shopId: inputs.shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const shopItemReceipts = await fetchShopItemReceiptSummaries({
      ownerAddress: inputs.ownerAddress,
      shopPackageId: inputs.shopPackageId,
      shopFilterId: inputs.shopId,
      suiClient
    })

    if (shopItemReceipts.length === 0)
      return logEmptyList("Purchased-items", "No ShopItem receipts found.")

    const listingDetails = await fetchListingDetailsForReceipts(
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

const fetchListingDetailsForReceipts = async (
  shopItemReceipts: Awaited<ReturnType<typeof fetchShopItemReceiptSummaries>>,
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
