/**
 * Clears the listing's spotlight DiscountTemplate reference.
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import {
  buildClearDiscountTemplateTransaction,
  resolveListingIdForShop
} from "@sui-oracle-market/domain-core/ptb/item-listing"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogItemListingMutationResult,
  executeItemListingMutation,
  fetchItemListingSummaryForMutation,
  resolveOwnerListingMutationContext
} from "./item-listing-script-helpers.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const resolvedListingId = await resolveListingIdForShop({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      suiClient: tooling.suiClient
    })
    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const clearDiscountTemplateTransaction =
      buildClearDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListingId: resolvedListingId,
        ownerCapId: inputs.ownerCapId
      })

    const mutationResult = await executeItemListingMutation({
      tooling,
      transaction: clearDiscountTemplateTransaction,
      summaryLabel: "clear-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return

    const { execution, summary } = mutationResult

    const listingSummary = await fetchItemListingSummaryForMutation({
      shopId: inputs.shopId,
      itemListingId: resolvedListingId,
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
      description:
        "Item listing object ID to clear the spotlighted discount from.",
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
    itemListingId
  }
}
