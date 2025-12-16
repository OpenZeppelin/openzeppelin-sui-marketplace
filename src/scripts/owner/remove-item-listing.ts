import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
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
    const removeItemTransaction = buildRemoveItemTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemListingId: cliArguments.itemListingId
    })

    const {
      objectArtifacts: { deleted }
    } = await signAndExecute(
      {
        transaction: removeItemTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    console.log(deleted)

    logRemovalResult(deleted[0])
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

const fetchMutableShop = async (shopId: string, client: SuiClient) =>
  getSuiSharedObject({ objectId: shopId, mutable: true }, client)

const buildRemoveItemTransaction = ({
  packageId,
  shop,
  ownerCapId,
  itemListingId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  itemListingId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::remove_item_listing`,
    arguments: [
      shopArgument,
      transaction.pure.id(itemListingId),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const logRemovalResult = (deletedItemListing: ObjectArtifact) => {
  logKeyValueGreen("removed")(deletedItemListing.objectId)
  if (deletedItemListing.digest)
    logKeyValueGreen("digest")(deletedItemListing.digest)
}
