/**
 * Deletes an ItemListing by removing its marker and destroying the listing object.
 * Requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { buildDeleteItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type DeleteItemArguments = {
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
    const itemListingSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.itemListingId
    })
    const deleteItemTransaction = buildDeleteItemListingTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemListing: itemListingSharedObject
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: deleteItemTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "delete-item-listing",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

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
      description:
            "ItemListing object ID to delete (object ID, not a type tag).",
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
  cliArguments: DeleteItemArguments,
  networkName: string
): Promise<NormalizedInputs> => {
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
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId)
  }
}
