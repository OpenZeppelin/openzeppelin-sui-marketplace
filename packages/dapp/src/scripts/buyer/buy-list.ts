/**
 * Lists ShopItem receipt objects owned by an address and enriches them with listing metadata.
 * On Sui, receipts are address-owned objects (typed proofs), not events or mapping entries.
 * The Shop is only used to resolve listing and item metadata; receipts stay in the wallet.
 */
import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getItemListingDetails } from "@sui-oracle-market/domain-core/models/item-listing"
import { getShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { normalizeIdOrThrow } from "@sui-oracle-market/tooling-core/object"
import { mapSettledWithWarnings } from "@sui-oracle-market/tooling-core/utils/settled"
import { resolveOwnerAddress } from "@sui-oracle-market/tooling-node/account"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { type SuiNetworkConfig } from "@sui-oracle-market/tooling-node/config"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logWarning } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logListContextWithHeader } from "../../utils/context.ts"
import {
  logEmptyList,
  logShopItemReceiptSummary
} from "../../utils/log-summaries.ts"

type ListPurchasesArguments = {
  address?: string
  shopPackageId?: string
  shopId?: string
  json?: boolean
}

type ListingDetailsWarning = {
  itemListingId: string
  shopId: string
  error: string
}

runSuiScript(
  async (tooling, cliArguments: ListPurchasesArguments) => {
    const inputs = await resolveInputs(
      cliArguments,
      tooling.network.networkName,
      tooling.network
    )

    const shopItemReceipts = await getShopItemReceiptSummaries({
      ownerAddress: inputs.ownerAddress,
      shopPackageId: inputs.shopPackageId,
      shopFilterId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    const listingWarnings: ListingDetailsWarning[] = []
    const listingDetails = await getListingDetailsForReceipts(
      shopItemReceipts,
      tooling.suiClient,
      (receipt, reason) => {
        const warning = {
          itemListingId: receipt.itemListingId,
          shopId: receipt.shopId,
          error: reason instanceof Error ? reason.message : String(reason)
        }

        if (cliArguments.json) listingWarnings.push(warning)
        else
          logWarning(
            `Unable to fetch listing ${warning.itemListingId}: ${warning.error}`
          )
      }
    )

    if (
      emitJsonOutput(
        {
          ownerAddress: inputs.ownerAddress,
          shopPackageId: inputs.shopPackageId,
          shopId: inputs.shopId,
          receipts: shopItemReceipts,
          listingDetails,
          listingWarnings
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
        rpcUrl: tooling.network.url,
        networkName: tooling.network.networkName,
        shopLabel: "Shop-filter"
      },
      { label: "Purchased-items", count: shopItemReceipts.length }
    )

    if (shopItemReceipts.length === 0)
      return logEmptyList("Purchased-items", "No ShopItem receipts found.")

    shopItemReceipts.forEach((shopItem, index) =>
      logShopItemReceiptSummary(shopItem, index + 1, listingDetails[index])
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
      description: "Optional Shop object ID to filter by shop id."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ListPurchasesArguments,
  networkName: string,
  networkConfig: SuiNetworkConfig
) => {
  const shopArtifact =
    await getLatestObjectFromArtifact("shop::Shop")(networkName)

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
  suiClient: SuiClient,
  onError: (
    receipt: { itemListingId: string; shopId: string },
    reason: unknown
  ) => void
) =>
  mapSettledWithWarnings({
    items: shopItemReceipts,
    task: (receipt) =>
      getItemListingDetails(
        receipt.shopId,
        receipt.itemListingId,
        suiClient
      ),
    onError
  })
