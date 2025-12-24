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
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  logDiscountTemplateSummary,
  logItemListingSummary
} from "../../utils/log-summaries.ts"

type AttachDiscountTemplateArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
  discountTemplateId: string
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  itemListingId: string
  discountTemplateId: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const suiClient = tooling.suiClient

    const resolvedIds = await validateTemplateAndListing({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient
    })

    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: false
    })
    const itemListingSharedObject = await tooling.getSuiSharedObject({
      objectId: resolvedIds.itemListingId,
      mutable: true
    })
    const discountTemplateSharedObject = await tooling.getSuiSharedObject({
      objectId: resolvedIds.discountTemplateId,
      mutable: false
    })

    const attachDiscountTemplateTransaction =
      buildAttachDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListing: itemListingSharedObject,
        discountTemplate: discountTemplateSharedObject,
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: attachDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const [listingSummary, discountTemplateSummary] = await Promise.all([
      getItemListingSummary(
        inputs.shopId,
        resolvedIds.itemListingId,
        suiClient
      ),
      getDiscountTemplateSummary(
        inputs.shopId,
        resolvedIds.discountTemplateId,
        suiClient
      )
    ])

    logItemListingSummary(listingSummary)
    logDiscountTemplateSummary(discountTemplateSummary)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
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
        "Package ID for the sui_oracle_market Move package; inferred from artifacts if omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact if available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID that authorizes attaching the template; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: AttachDiscountTemplateArguments,
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveLatestShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

  return {
    packageId,
    shopId,
    ownerCapId,
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId),
    discountTemplateId: normalizeSuiObjectId(cliArguments.discountTemplateId)
  }
}
