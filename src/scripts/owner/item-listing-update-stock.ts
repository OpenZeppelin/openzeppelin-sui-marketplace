import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { parseNonNegativeU64 } from "../../utils/utility.ts"

type UpdateStockArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
  stock: string
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  itemListingId: string
  newStock: bigint
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const itemListingSharedObject = await getSuiSharedObject(
      { objectId: inputs.itemListingId, mutable: true },
      suiClient
    )

    const updateStockTransaction = buildUpdateStockTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      itemListing: itemListingSharedObject,
      ownerCapId: inputs.ownerCapId,
      newStock: inputs.newStock
    })

    const { transactionResult } = await signAndExecute(
      {
        transaction: updateStockTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logStockUpdate({
      itemListingId: inputs.itemListingId,
      newStock: inputs.newStock,
      digest: transactionResult.digest
    })
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
        "ShopOwnerCap object ID that authorizes the stock update; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: UpdateStockArguments,
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
    newStock: parseNonNegativeU64(cliArguments.stock, "stock")
  }
}

const buildUpdateStockTransaction = ({
  packageId,
  shop,
  itemListing,
  ownerCapId,
  newStock
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  itemListing: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  newStock: bigint
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const listingArgument = transaction.sharedObjectRef(itemListing.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_item_listing_stock`,
    arguments: [
      shopArgument,
      listingArgument,
      transaction.pure.u64(newStock),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const logStockUpdate = ({
  itemListingId,
  newStock,
  digest
}: {
  itemListingId: string
  newStock: bigint
  digest?: string
}) => {
  logKeyValueGreen("item id")(itemListingId)
  logKeyValueGreen("new stock")(newStock.toString())
  if (digest) logKeyValueGreen("digest")(digest)
}
