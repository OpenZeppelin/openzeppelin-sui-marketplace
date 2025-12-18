import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

type RemoveItemArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await fetchMutableShop(inputs.shopId, suiClient)
    const itemListingSharedObject = await getSuiSharedObject(
      { objectId: inputs.itemListingId, mutable: false },
      suiClient
    )
    const removeItemTransaction = buildRemoveItemTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemListing: itemListingSharedObject
    })

    const { transactionResult } = await signAndExecute(
      {
        transaction: removeItemTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logKeyValueGreen("deleted")(inputs.itemListingId)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description:
        "ItemListing object ID to remove (object ID, not a type tag).",
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
        "ShopOwnerCap object ID that authorizes removing listings; defaults to the latest artifact when omitted."
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

const fetchMutableShop = async (shopId: string, client: SuiClient) =>
  getSuiSharedObject({ objectId: shopId, mutable: true }, client)

const buildRemoveItemTransaction = ({
  packageId,
  shop,
  ownerCapId,
  itemListing
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  itemListing: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::remove_item_listing`,
    arguments: [shopArgument, listingArgument, transaction.object(ownerCapId)]
  })

  return transaction
}
