/**
 * Sets the listing's spotlight Discount reference for UI promotion.
 * Validates discount ownership and requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountSummary } from "@sui-oracle-market/domain-core/models/discount"
import {
  buildAttachDiscountTransaction,
  validateDiscountAndListing
} from "@sui-oracle-market/domain-core/ptb/item-listing"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logDiscountSummary,
  logItemListingSummary
} from "../../utils/log-summaries.ts"
import {
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

    const resolvedIds = await validateDiscountAndListing({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      discountId: inputs.discountId,
      suiClient: tooling.suiClient
    })

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const attachDiscountTransaction = buildAttachDiscountTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      itemListingId: resolvedIds.itemListingId,
      discountId: resolvedIds.discountId,
      ownerCapId: inputs.ownerCapId
    })

    const mutationResult = await executeItemListingMutation({
      tooling,
      transaction: attachDiscountTransaction,
      summaryLabel: "attach-discount",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return

    const { execution, summary } = mutationResult
    const digest = execution.transactionResult.digest

    const [listingSummary, discountSummary] = await Promise.all([
      fetchItemListingSummaryForMutation({
        shopId: inputs.shopId,
        itemListingId: resolvedIds.itemListingId,
        tooling
      }),
      getDiscountSummary(
        inputs.shopId,
        resolvedIds.discountId,
        tooling.suiClient
      )
    ])

    if (
      emitJsonOutput(
        {
          itemListing: listingSummary,
          discount: discountSummary,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logItemListingSummary(listingSummary)
    logDiscountSummary(discountSummary)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description: "Item listing ID to attach the discount to.",
      demandOption: true
    })
    .option("discountId", {
      alias: ["discount-id"],
      type: "string",
      description: "Discount ID to spotlight on the listing.",
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
    discountId: string
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
    discountId: normalizeSuiObjectId(cliArguments.discountId)
  }
}
