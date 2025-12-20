import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { parseUsdToCents } from "@sui-oracle-market/domain-core/models/shop"
import { buildAddItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import {
  normalizeIdOrThrow,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"
import { logItemListingSummary } from "../../utils/log-summaries.js"

type AddItemArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  name: string
  price: string
  stock: string
  itemType: string
  spotlightDiscountId?: string
  publisherId?: string
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

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

    const {
      objectArtifacts: {
        created: [createdItemListing]
      }
    } = await signAndExecute(
      {
        transaction: addItemTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    const listingId = normalizeIdOrThrow(
      createdItemListing?.objectId,
      "Expected an ItemListing to be created."
    )
    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      listingId,
      suiClient
    )

    logItemListingSummary(listingSummary)
    if (createdItemListing?.digest)
      logKeyValueGreen("digest")(createdItemListing.digest)
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
  cliArguments: AddItemArguments,
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
