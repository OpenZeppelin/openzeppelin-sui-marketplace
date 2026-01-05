/**
 * Updates the stock quantity for an ItemListing.
 * The listing is a mutable object; stock changes are object mutations guarded by ShopOwnerCap.
 * If you come from EVM, this is like updating inventory in a mapping, but via object state changes.
 * The script submits a transaction and then re-reads the listing summary.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { buildUpdateItemListingStockTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logItemListingSummary } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

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
    const shopSharedObject = await tooling.getImmutableSharedObject({
      objectId: inputs.shopId
    })
    const itemListingSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.itemListingId
    })

    const updateStockTransaction = buildUpdateItemListingStockTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      itemListing: itemListingSharedObject,
      ownerCapId: inputs.ownerCapId,
      newStock: inputs.newStock
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateStockTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "update-item-stock",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      inputs.itemListingId,
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
      description:
        "ItemListing object ID to update (object ID, not a type tag).",
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
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId),
    newStock: parseNonNegativeU64(cliArguments.stock, "stock")
  }
}
