/**
 * Attaches a DiscountTemplate to an ItemListing so the listing advertises that promotion.
 * Listings and templates are separate objects; this script mutates the listing to reference the template.
 * If you come from EVM, think of updating a struct field on a stored object rather than writing a mapping.
 * Requires the ShopOwnerCap capability because the listing is a shared object.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import {
  buildAttachDiscountTemplateTransaction,
  validateTemplateAndListing
} from "@sui-oracle-market/domain-core/ptb/item-listing"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logDiscountTemplateSummary,
  logItemListingSummary
} from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const resolvedIds = await validateTemplateAndListing({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient: tooling.suiClient
    })

    const shopSharedObject = await tooling.getImmutableSharedObject({
      objectId: inputs.shopId
    })
    const itemListingSharedObject = await tooling.getMutableSharedObject({
      objectId: resolvedIds.itemListingId
    })
    const discountTemplateSharedObject = await tooling.getImmutableSharedObject(
      { objectId: resolvedIds.discountTemplateId }
    )

    const attachDiscountTemplateTransaction =
      buildAttachDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListing: itemListingSharedObject,
        discountTemplate: discountTemplateSharedObject,
        ownerCapId: inputs.ownerCapId
      })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: attachDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "attach-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    const [listingSummary, discountTemplateSummary] = await Promise.all([
      getItemListingSummary(
        inputs.shopId,
        resolvedIds.itemListingId,
        tooling.suiClient
      ),
      getDiscountTemplateSummary(
        inputs.shopId,
        resolvedIds.discountTemplateId,
        tooling.suiClient
      )
    ])

    if (
      emitJsonOutput(
        {
          itemListing: listingSummary,
          discountTemplate: discountTemplateSummary,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logItemListingSummary(listingSummary)
    logDiscountTemplateSummary(discountTemplateSummary)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description:
        "ItemListing object ID to attach the discount to (object ID, not a type tag).",
      demandOption: true
    })
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description:
        "DiscountTemplate object ID to spotlight on the listing (object ID).",
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
    discountTemplateId: string
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
    discountTemplateId: normalizeSuiObjectId(cliArguments.discountTemplateId)
  }
}
