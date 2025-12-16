import type { SuiObjectChangeCreated } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { parseUsdToCents } from "../../models/shop.ts"
import {
  getLatestObjectFromArtifact,
  getObjectArtifactPath,
  readArtifact,
  writeObjectArtifact
} from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import {
  extractInitialSharedVersion,
  getSuiDynamicFieldObject,
  getSuiSharedObject,
  mapOwnerToArtifact,
  normalizeOptionalId,
  normalizeVersion,
  type ObjectArtifact,
  type ObjectArtifactPackageInfo
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  ensureCreatedObject,
  newTransaction,
  signAndExecute
} from "../../tooling/transactions.ts"
import { tryParseBigInt } from "../../utils/utility.ts"

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
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

    const addItemTransaction = buildAddItemTransaction({
      packageId: inputs.packageId,
      itemType: inputs.itemType,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemName: inputs.name,
      basePriceUsdCents: inputs.priceCents,
      stock: inputs.stock,
      spotlightDiscountId: inputs.spotlightDiscountId
    })

    const transactionResult = await signAndExecute(
      { transaction: addItemTransaction, signer },
      suiClient
    )

    const listingId = extractItemListingId(transactionResult)
    const packageInfo = await resolvePackageInfo(
      inputs.packageId,
      inputs.publisherId,
      signer.toSuiAddress(),
      network.networkName
    )
    const listingObject = await getItemListing({
      listingId,
      shopId: inputs.shopId,
      client: suiClient
    })

    //TODO transform this function to a withArtifact function that take any function that returns an object and save it in the artifacts (same with delete but adds a deleted: timestamp key)
    await writeObjectArtifact(getObjectArtifactPath(network.networkName), [
      buildItemListingArtifact(packageInfo, listingObject)
    ])

    logListingCreation(listingObject)
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

const buildAddItemTransaction = ({
  packageId,
  itemType,
  shop,
  ownerCapId,
  itemName,
  basePriceUsdCents,
  stock,
  spotlightDiscountId
}: {
  packageId: string
  itemType: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  itemName: string
  basePriceUsdCents: bigint
  stock: bigint
  spotlightDiscountId?: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::add_item_listing`,
    typeArguments: [itemType],
    arguments: [
      shopArgument,
      transaction.pure.vector("u8", encodeItemName(itemName)),
      transaction.pure.u64(basePriceUsdCents),
      transaction.pure.u64(stock),
      transaction.pure.option("address", spotlightDiscountId ?? null),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const encodeItemName = (name: string): Uint8Array => {
  if (!name.trim()) throw new Error("Item name cannot be empty.")
  return new TextEncoder().encode(name)
}

const normalizeInputs = async (
  cliArguments: AddItemArguments,
  networkName: string
) => {
  const latestShopObject = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  const latestOwnerCapObject = await getLatestObjectFromArtifact(
    "shop::ShopOwnerCap",
    networkName
  )

  const shopPackageId =
    cliArguments.shopPackageId || latestShopObject?.packageId

  if (!shopPackageId)
    throw new Error(
      "A shop package id is required, publish first or pass it as --shop-package-id "
    )

  const shopId = cliArguments.shopId || latestShopObject?.objectId

  if (!shopId)
    throw new Error(
      "A shop store id is required, create a new store first or pass it as --shop-id "
    )

  const ownerCapId = cliArguments.ownerCapId || latestOwnerCapObject?.objectId

  if (!ownerCapId)
    throw new Error(
      "A owner cap id is required, create a new store first or pass it as --owner-cap-id"
    )

  const spotlightDiscountId = normalizeOptionalId(
    cliArguments.spotlightDiscountId
  )
  const itemType = cliArguments.itemType.trim()

  if (!itemType)
    throw new Error("itemType must be a fully qualified Move type.")

  return {
    packageId: normalizeSuiObjectId(shopPackageId),
    shopId: normalizeSuiObjectId(shopId),
    ownerCapId: normalizeSuiObjectId(ownerCapId),
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

const parsePositiveU64 = (rawValue: string, label: string): bigint => {
  const value = tryParseBigInt(rawValue)
  if (value <= 0n) throw new Error(`${label} must be greater than zero.`)
  return value
}

const extractItemListing = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): SuiObjectChangeCreated =>
  ensureCreatedObject("shop::ItemListing", transactionResult)

const extractItemListingId = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): string => {
  try {
    return extractItemListing(transactionResult).objectId
  } catch {
    const listingIdFromEvents = findListingIdInEvents(transactionResult)
    if (listingIdFromEvents) return listingIdFromEvents
    throw new Error(
      "Transaction succeeded but ItemListing was not found; no ItemListingAdded event present."
    )
  }
}

const findListingIdInEvents = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): string | undefined =>
  (transactionResult.events ?? []).reduce<string | undefined>(
    (found, event) => {
      if (found) return found
      const parsed = event.parsedJson as
        | {
            item_listing_address?: string
          }
        | undefined
      const matches =
        typeof event.type === "string" &&
        event.type.endsWith("::shop::ItemListingAdded") &&
        typeof parsed?.item_listing_address === "string"
      return matches ? parsed.item_listing_address : undefined
    },
    undefined
  )

const getItemListing = async ({
  listingId,
  shopId,
  client
}: {
  listingId: string
  shopId: string
  client: SuiClient
}) => {
  const dynamicFieldObject = await getSuiDynamicFieldObject(
    {
      childObjectId: listingId,
      parentObjectId: shopId
    },
    client
  )

  return {
    objectId: normalizeSuiObjectId(listingId),
    objectType: dynamicFieldObject.object.type,
    dynamicFieldId: dynamicFieldObject.dynamicFieldId,
    owner: dynamicFieldObject.object.owner,
    initialSharedVersion: extractInitialSharedVersion(
      dynamicFieldObject.object
    ),
    version: dynamicFieldObject.object.version,
    digest: dynamicFieldObject.object.digest
  }
}

const resolvePackageInfo = async (
  packageId: string,
  publisherId: string | undefined,
  signer: string,
  networkName: string
): Promise<ObjectArtifactPackageInfo> => {
  const normalizedPackageId = normalizeSuiObjectId(packageId)
  const normalizedPublisherId =
    publisherId ??
    (await resolvePublisherFromArtifacts(normalizedPackageId, networkName))

  if (!normalizedPublisherId)
    throw new Error(
      "Unable to resolve publisherId. Provide --publisher-id or ensure objects artifact contains one."
    )

  return {
    packageId: normalizedPackageId,
    publisherId: normalizedPublisherId,
    signer
  }
}

const resolvePublisherFromArtifacts = async (
  packageId: string,
  networkName: string
): Promise<string | undefined> => {
  const objectArtifacts = await readArtifact<ObjectArtifact[]>(
    getObjectArtifactPath(networkName),
    []
  )

  const artifact = objectArtifacts.find(
    (existing) => existing.packageId === packageId
  )

  return artifact?.publisherId
    ? normalizeSuiObjectId(artifact.publisherId)
    : undefined
}

const buildItemListingArtifact = (
  packageInfo: ObjectArtifactPackageInfo,
  listingObject: Awaited<ReturnType<typeof getItemListing>>
): ObjectArtifact => ({
  ...packageInfo,
  objectId: listingObject.objectId,
  objectType: listingObject.objectType || "MISSING",
  dynamicFieldId: listingObject.dynamicFieldId,
  objectName: "itemListing",
  owner: mapOwnerToArtifact(listingObject.owner || undefined),
  initialSharedVersion: normalizeVersion(listingObject.initialSharedVersion),
  version: normalizeVersion(listingObject.version),
  digest: listingObject.digest
})

const logListingCreation = (
  listing: Awaited<ReturnType<typeof getItemListing>>
) => {
  logKeyValueGreen("item id")(listing.objectId)
  if (listing.digest) logKeyValueGreen("digest")(listing.digest)
}
