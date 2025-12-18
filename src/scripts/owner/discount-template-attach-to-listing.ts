import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import {
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { fetchObjectWithDynamicFieldFallback } from "../../tooling/dynamic-fields.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

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
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })

    const resolvedIds = await validateTemplateAndListing({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient
    })

    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const itemListingSharedObject = await getSuiSharedObject(
      { objectId: resolvedIds.itemListingId, mutable: true },
      suiClient
    )
    const discountTemplateSharedObject = await getSuiSharedObject(
      { objectId: resolvedIds.discountTemplateId, mutable: false },
      suiClient
    )

    const attachDiscountTemplateTransaction =
      buildAttachDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListing: itemListingSharedObject,
        discountTemplate: discountTemplateSharedObject,
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await signAndExecute(
      {
        transaction: attachDiscountTemplateTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logAttachmentResult({
      itemListingId: resolvedIds.itemListingId,
      discountTemplateId: resolvedIds.discountTemplateId,
      digest: transactionResult.digest
    })
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

const fetchItemListingMetadata = async (
  listingId: string,
  shopId: string,
  suiClient: SuiClient
) => {
  const object = await fetchObjectWithDynamicFieldFallback(
    { objectId: listingId, parentObjectId: shopId },
    suiClient
  )

  const fields = unwrapMoveObjectFields(object)
  const rawShopAddress = fields.shop_address
  if (typeof rawShopAddress !== "string")
    throw new Error(
      `Item listing ${listingId} is missing a shop_address field.`
    )
  const shopAddress = normalizeSuiObjectId(rawShopAddress)
  const normalizedListingId =
    normalizeOptionalIdFromValue(fields.id) ?? normalizeSuiObjectId(listingId)

  return {
    id: normalizedListingId,
    shopAddress
  }
}

const fetchDiscountTemplateMetadata = async (
  templateId: string,
  shopId: string,
  suiClient: SuiClient
) => {
  const object = await fetchObjectWithDynamicFieldFallback(
    { objectId: templateId, parentObjectId: shopId },
    suiClient
  )

  const fields = unwrapMoveObjectFields(object)
  const rawShopAddress = fields.shop_address
  if (typeof rawShopAddress !== "string")
    throw new Error(
      `Discount template ${templateId} is missing a shop_address field.`
    )
  const shopAddress = normalizeSuiObjectId(rawShopAddress)

  return {
    id:
      normalizeOptionalIdFromValue(fields.id) ??
      normalizeSuiObjectId(templateId),
    shopAddress,
    appliesToListing: normalizeOptionalIdFromValue(fields.applies_to_listing)
  }
}

const validateTemplateAndListing = async ({
  shopId,
  itemListingId,
  discountTemplateId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  discountTemplateId: string
  suiClient: SuiClient
}): Promise<{ itemListingId: string; discountTemplateId: string }> => {
  const [listing, template] = await Promise.all([
    fetchItemListingMetadata(itemListingId, shopId, suiClient),
    fetchDiscountTemplateMetadata(discountTemplateId, shopId, suiClient)
  ])

  const normalizedShopId = normalizeSuiObjectId(shopId)

  if (listing.shopAddress !== normalizedShopId)
    throw new Error(
      `Item listing ${listing.id} belongs to shop ${listing.shopAddress}, not ${normalizedShopId}.`
    )

  if (template.shopAddress !== normalizedShopId)
    throw new Error(
      `Discount template ${template.id} belongs to shop ${template.shopAddress}, not ${normalizedShopId}.`
    )

  if (template.appliesToListing && template.appliesToListing !== listing.id)
    throw new Error(
      `Discount template ${template.id} is pinned to listing ${template.appliesToListing} and cannot be attached to ${listing.id}. Create a template for this listing or use the pinned listing.`
    )

  return {
    itemListingId: listing.id,
    discountTemplateId: template.id
  }
}

const buildAttachDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListing,
  discountTemplate,
  ownerCapId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  itemListing: Awaited<ReturnType<typeof getSuiSharedObject>>
  discountTemplate: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)
  const templateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::attach_template_to_listing`,
    arguments: [
      shopArgument,
      listingArgument,
      templateArgument,
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const logAttachmentResult = ({
  itemListingId,
  discountTemplateId,
  digest
}: {
  itemListingId: string
  discountTemplateId: string
  digest?: string
}) => {
  logKeyValueGreen("item id")(itemListingId)
  logKeyValueGreen("template id")(discountTemplateId)
  if (digest) logKeyValueGreen("digest")(digest)
}
