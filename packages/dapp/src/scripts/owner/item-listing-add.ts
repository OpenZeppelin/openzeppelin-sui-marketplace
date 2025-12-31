/**
 * Adds a new ItemListing to a Shop with price, stock, and item type metadata.
 * The Shop is a shared object, while listings are separate objects created and owned by the Shop logic.
 * If you come from EVM, instead of pushing data into a mapping, you create a new on-chain object with its own ID.
 * Authorization is via the ShopOwnerCap capability object, not a contract-admin role.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { parseUsdToCents } from "@sui-oracle-market/domain-core/models/shop"
import { buildAddItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop"
import {
  normalizeIdOrThrow,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { ensureCreatedObject } from "@sui-oracle-market/tooling-node/transactions"
import { logItemListingSummary } from "../../utils/log-summaries.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: true
    })

    const addItemTransaction = buildAddItemListingTransaction({
      packageId: inputs.packageId,
      itemType: inputs.itemType,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemName: inputs.name,
      basePriceUsdCents: inputs.priceCents,
      stock: inputs.stock,
      spotlightDiscountId: inputs.spotlightDiscountId
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: addItemTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const createdListingChange = ensureCreatedObject(
      "::shop::ItemListing",
      transactionResult
    )

    const listingId = normalizeIdOrThrow(
      createdListingChange.objectId,
      "Expected an ItemListing to be created."
    )
    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      listingId,
      tooling.suiClient
    )

    logItemListingSummary(listingSummary)
    if (createdListingChange.digest)
      logKeyValueGreen("digest")(createdListingChange.digest)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package. If omitted, the script will infer it from the latest Shop entry in deployments/objects.<network>.json",
      demandOption: false
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description: "Shared Shop object ID",
      demandOption: false
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description: "ShopOwnerCap object ID that authorizes the mutation",
      demandOption: false
    })
    .option("name", {
      type: "string",
      description: "Human-readable item name",
      demandOption: true
    })
    .option("price", {
      alias: ["price-cents", "usd-cents", "usd"],
      type: "string",
      description:
        "Listing price expressed in USD cents (e.g., 1250 for $12.50). Decimal input will be converted to cents.",
      demandOption: true
    })
    .option("stock", {
      type: "string",
      description: "Initial stock quantity (u64)",
      demandOption: true
    })
    .option("itemType", {
      alias: "item-type",
      type: "string",
      description:
        "Fully qualified Move type for the item (e.g., 0x...::module::ItemType)",
      demandOption: true
    })
    .option("spotlightDiscountId", {
      alias: ["spotlight-discount-id", "discount-id"],
      type: "string",
      description:
        "Optional discount template ID to spotlight for this listing (Shop::DiscountTemplate)"
    })
    .option("publisherId", {
      alias: "publisher-id",
      type: "string",
      description:
        "Publisher object ID for artifacts; inferred from existing objects if omitted"
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    name: string
    price: string
    stock: string
    itemType: string
    spotlightDiscountId?: string
    publisherId?: string
  },
  networkName: string
) => {
  const { packageId, shopId, ownerCapId } = await resolveLatestShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

  const spotlightDiscountId = normalizeOptionalId(
    cliArguments.spotlightDiscountId
  )
  const itemType = cliArguments.itemType.trim()

  if (!itemType)
    throw new Error("itemType must be a fully qualified Move type.")

  return {
    packageId,
    shopId,
    ownerCapId,
    spotlightDiscountId,
    itemType,
    name: cliArguments.name,
    priceCents: parseUsdToCents(cliArguments.price),
    stock: parsePositiveU64(cliArguments.stock, "stock"),
    publisherId: cliArguments.publisherId
      ? normalizeSuiObjectId(cliArguments.publisherId)
      : undefined
  }
}
