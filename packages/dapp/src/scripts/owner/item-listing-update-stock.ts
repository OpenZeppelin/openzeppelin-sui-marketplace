import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { buildUpdateItemListingStockTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"
import { logItemListingSummary } from "../../utils/log-summaries.js"

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
  async ({ network }, cliArguments: UpdateStockArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const itemListingSharedObject = await getSuiSharedObject(
      { objectId: inputs.itemListingId, mutable: true },
      suiClient
    )

    const updateStockTransaction = buildUpdateItemListingStockTransaction({
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

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      inputs.itemListingId,
      suiClient
    )

    logItemListingSummary(listingSummary)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
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
