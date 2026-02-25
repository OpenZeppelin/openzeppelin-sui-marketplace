/**
 * Updates inventory on a table-backed ItemListing.
 * Requires the ShopOwnerCap capability and emits stock update events.
 */
import yargs from "yargs"

import { buildUpdateItemListingStockTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogItemListingMutationResult,
  executeItemListingMutation,
  fetchItemListingSummaryForMutation,
  resolveOwnerListingMutationContext
} from "./item-listing-script-helpers.ts"

runSuiScript(
  async (
    tooling,
    cliArguments: {
      shopPackageId?: string
      shopId?: string
      ownerCapId?: string
      itemListingId: string
      stock: string
      devInspect?: boolean
      dryRun?: boolean
      json?: boolean
    }
  ) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const shopMutableSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const updateStockTransaction = buildUpdateItemListingStockTransaction({
      packageId: inputs.packageId,
      shop: shopMutableSharedObject,
      itemListingId: inputs.itemListingId,
      ownerCapId: inputs.ownerCapId,
      newStock: inputs.newStock
    })

    const mutationResult = await executeItemListingMutation({
      tooling,
      transaction: updateStockTransaction,
      summaryLabel: "update-item-stock",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return

    const { execution, summary } = mutationResult

    const listingSummary = await fetchItemListingSummaryForMutation({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      tooling
    })

    emitOrLogItemListingMutationResult({
      itemListingSummary: listingSummary,
      digest: execution.transactionResult.digest,
      transactionSummary: summary,
      json: cliArguments.json
    })
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description: "Item listing ID to update (u64).",
      demandOption: true
    })
    .option("stock", {
      alias: ["new-stock", "quantity"],
      type: "string",
      description:
        "New inventory quantity for the listing. Use 0 to pause selling without removing the listing.",
      demandOption: true
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
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID authorizing the mutation; defaults to the latest artifact when omitted."
    })
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    itemListingId: string
    stock: string
  },
  networkName: string
) => {
  const { packageId, shopId, ownerCapId, itemListingId } =
    await resolveOwnerListingMutationContext({
      networkName,
      shopPackageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId,
      itemListingId: cliArguments.itemListingId
    })

  return {
    packageId,
    shopId,
    ownerCapId,
    itemListingId,
    newStock: parseNonNegativeU64(cliArguments.stock, "stock")
  }
}
