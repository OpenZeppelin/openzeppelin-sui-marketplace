import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
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
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

    const clearDiscountTemplateTransaction =
      buildClearDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        itemListingId: inputs.itemListingId,
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
      itemListingId: inputs.itemListingId,
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
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )
  const ownerCapArtifact = await getLatestObjectFromArtifact(
    "shop::ShopOwnerCap",
    networkName
  )

  const packageId = cliArguments.shopPackageId || shopArtifact?.packageId
  if (!packageId)
    throw new Error(
      "A shop package id is required; publish the package first or provide --shop-package-id."
    )

  const shopId = cliArguments.shopId || shopArtifact?.objectId
  if (!shopId)
    throw new Error(
      "A shop id is required; create a shop first or provide --shop-id."
    )

  const ownerCapId = cliArguments.ownerCapId || ownerCapArtifact?.objectId
  if (!ownerCapId)
    throw new Error(
      "An owner cap id is required; create a shop first or provide --owner-cap-id."
    )

  return {
    packageId: normalizeSuiObjectId(packageId),
    shopId: normalizeSuiObjectId(shopId),
    ownerCapId: normalizeSuiObjectId(ownerCapId),
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId)
  }
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
