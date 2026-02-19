/**
 * Clears the listing's spotlight DiscountTemplate reference.
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import {
  buildClearDiscountTemplateTransaction,
  resolveListingIdForShop
} from "@sui-oracle-market/domain-core/ptb/item-listing"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logItemListingSummary } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

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

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: clearDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "clear-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      resolvedListingId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          itemListing: listingSummary,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logItemListingSummary(listingSummary)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description: "Listing id (u64) to clear the spotlighted discount from.",
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
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

  return {
    packageId,
    shopId,
    ownerCapId,
    itemListingId: parseNonNegativeU64(
      cliArguments.itemListingId,
      "itemListingId"
    ).toString()
  }
}
