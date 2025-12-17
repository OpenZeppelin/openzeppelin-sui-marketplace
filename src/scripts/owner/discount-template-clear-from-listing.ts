import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import {
  fetchObjectWithDynamicFieldFallback,
  getSuiSharedObject,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

type ClearDiscountTemplateArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  itemListingId: string
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const resolvedListingId = await resolveListingId({
      shopId: inputs.shopId,
      itemListingId: inputs.itemListingId,
      suiClient
    })
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

    const clearDiscountTemplateTransaction =
      buildClearDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListingId: resolvedListingId,
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await signAndExecute(
      {
        transaction: clearDiscountTemplateTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logClearResult({
      itemListingId: resolvedListingId,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description:
        "ItemListing object ID to clear the spotlighted discount from (object ID, not a type tag).",
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
        "ShopOwnerCap object ID that authorizes clearing the template; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: ClearDiscountTemplateArguments,
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
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId)
  }
}

const resolveListingId = async ({
  shopId,
  itemListingId,
  suiClient
}: {
  shopId: string
  itemListingId: string
  suiClient: SuiClient
}): Promise<string> => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const listingObject = await fetchObjectWithDynamicFieldFallback(
    { objectId: itemListingId, parentObjectId: normalizedShopId },
    suiClient
  )
  const fields = unwrapMoveObjectFields(listingObject)

  const rawShopAddress = fields.shop_address
  if (typeof rawShopAddress !== "string")
    throw new Error(
      `Item listing ${itemListingId} is missing a shop_address field.`
    )

  const listingShop = normalizeSuiObjectId(rawShopAddress)
  if (listingShop !== normalizedShopId)
    throw new Error(
      `Item listing ${itemListingId} belongs to shop ${listingShop}, not ${normalizedShopId}.`
    )

  return (
    normalizeOptionalIdFromValue(fields.id) ??
    normalizeSuiObjectId(itemListingId)
  )
}

const buildClearDiscountTemplateTransaction = ({
  packageId,
  shop,
  itemListingId,
  ownerCapId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  itemListingId: string
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::clear_template_from_listing`,
    arguments: [
      shopArgument,
      transaction.pure.id(itemListingId),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const logClearResult = ({
  itemListingId,
  digest
}: {
  itemListingId: string
  digest?: string
}) => {
  logKeyValueGreen("item id")(itemListingId)
  if (digest) logKeyValueGreen("digest")(digest)
}
