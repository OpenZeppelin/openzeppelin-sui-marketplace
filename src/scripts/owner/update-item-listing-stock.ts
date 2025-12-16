import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { tryParseBigInt } from "../../utils/utility.ts"

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
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

    const updateStockTransaction = buildUpdateStockTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemListingId: inputs.itemListingId,
      newStock: inputs.newStock
    })

    const transactionResult = await signAndExecute(
      { transaction: updateStockTransaction, signer },
      suiClient
    )

    const updatedStock =
      parseUpdatedStockEvent(transactionResult) || inputs.newStock

    logStockUpdate({
      itemListingId: inputs.itemListingId,
      newStock: updatedStock,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("itemListingId", {
      alias: ["item-listing-id", "item-id", "listing-id"],
      type: "string",
      description: "ItemListing object ID to update (object ID, not a type tag).",
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
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId),
    newStock: parseNonNegativeU64(cliArguments.stock, "stock")
  }
}

const parseNonNegativeU64 = (rawValue: string, label: string): bigint => {
  const value = tryParseBigInt(rawValue)
  if (value < 0n) throw new Error(`${label} cannot be negative.`)

  const maxU64 = (1n << 64n) - 1n
  if (value > maxU64)
    throw new Error(`${label} exceeds the maximum allowed u64 value.`)

  return value
}

const buildUpdateStockTransaction = ({
  packageId,
  shop,
  ownerCapId,
  itemListingId,
  newStock
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  itemListingId: string
  newStock: bigint
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_item_listing_stock`,
    arguments: [
      shopArgument,
      transaction.pure.id(itemListingId),
      transaction.pure.u64(newStock),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const parseUpdatedStockEvent = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): bigint | undefined =>
  (transactionResult.events ?? []).reduce<bigint | undefined>(
    (latestValue, event) => {
      if (latestValue !== undefined) return latestValue
      const parsed = event.parsedJson as
        | { new_stock?: string | number }
        | undefined
      const matches =
        typeof event.type === "string" &&
        event.type.endsWith("::shop::ItemListingStockUpdated") &&
        (typeof parsed?.new_stock === "string" ||
          typeof parsed?.new_stock === "number")

      return matches ? BigInt(parsed?.new_stock ?? 0) : undefined
    },
    undefined
  )

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
