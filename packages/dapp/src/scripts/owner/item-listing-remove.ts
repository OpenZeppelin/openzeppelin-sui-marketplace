/**
 * Delists an ItemListing by removing its table entry under the Shop.
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import { buildRemoveItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  executeItemListingMutation,
  resolveOwnerListingMutationContext
} from "./item-listing-script-helpers.ts"

type RemoveItemArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })
    const removeItemTransaction = buildRemoveItemListingTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemListingId: inputs.itemListingId
    })

    const mutationResult = await executeItemListingMutation({
      tooling,
      transaction: removeItemTransaction,
      summaryLabel: "remove-item-listing",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return

    const { execution, summary } = mutationResult
    const digest = execution.transactionResult.digest
    if (
      emitJsonOutput(
        {
          deleted: inputs.itemListingId,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logKeyValueGreen("deleted")(inputs.itemListingId)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description: "Item listing ID to remove.",
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

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  itemListingId: string
}

const normalizeInputs = async (
  cliArguments: RemoveItemArguments,
  networkName: string
): Promise<NormalizedInputs> => {
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
