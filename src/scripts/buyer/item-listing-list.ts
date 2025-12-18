import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { fetchAllDynamicFields } from "../../tooling/dynamic-fields.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  decodeUtf8Vector,
  formatOptionalNumericValue
} from "../../utils/formatters.ts"
import { formatTypeNameFromFieldValue } from "../../utils/type-name.ts"

type ListItemListingsArguments = {
  shopId?: string
}

type ItemListingSummary = {
  itemListingId: string
  dynamicFieldObjectId: string
  name?: string
  itemType: string
  basePriceUsdCents?: string
  stock?: string
  spotlightTemplateId?: string
}

const ITEM_LISTING_MARKER_TYPE_FRAGMENT = "::shop::ItemListingMarker"

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const { shopId } = await resolveInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })

    logListContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const itemListings = await fetchItemListings(shopId, suiClient)
    if (itemListings.length === 0) {
      logKeyValueYellow("Item-listings")("No listings found.")
      return
    }

    itemListings.forEach(logItemListing)
  },
  yargs()
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available.",
      demandOption: false
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ListItemListingsArguments,
  networkName: string
) => {
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  return {
    shopId: normalizeIdOrThrow(
      cliArguments.shopId ?? shopArtifact?.objectId,
      "A shop id is required; create a shop first or provide --shop-id."
    )
  }
}

const fetchItemListings = async (
  shopId: string,
  suiClient: SuiClient
): Promise<ItemListingSummary[]> => {
  const dynamicFields = await fetchAllDynamicFields(shopId, suiClient)
  const itemListingFields = dynamicFields.filter((dynamicField) =>
    dynamicField.objectType?.includes(ITEM_LISTING_MARKER_TYPE_FRAGMENT)
  )

  if (itemListingFields.length === 0) return []

  const listingIds = itemListingFields.map((field) =>
    normalizeIdOrThrow(
      (field.name as { value: string })?.value,
      `Missing listing id for marker ${field.objectId}.`
    )
  )

  const itemListingObjects = await Promise.all(
    listingIds.map((listingId) =>
      getSuiObject(
        {
          objectId: listingId,
          options: { showContent: true, showType: true }
        },
        suiClient
      )
    )
  )

  return itemListingObjects.map((response, index) =>
    buildItemListingSummary(
      response.object,
      listingIds[index],
      itemListingFields[index].objectId
    )
  )
}

const buildItemListingSummary = (
  listingObject: SuiObjectData,
  listingId: string,
  dynamicFieldObjectId: string
): ItemListingSummary => {
  const itemListingFields = unwrapMoveObjectFields(listingObject)
  const itemType =
    formatTypeNameFromFieldValue(itemListingFields.item_type) || "Unknown"

  return {
    itemListingId: listingId,
    dynamicFieldObjectId,
    name: decodeUtf8Vector(itemListingFields.name),
    itemType,
    basePriceUsdCents: formatOptionalNumericValue(
      itemListingFields.base_price_usd_cents
    ),
    stock: formatOptionalNumericValue(itemListingFields.stock),
    spotlightTemplateId: normalizeOptionalIdFromValue(
      itemListingFields.spotlight_discount_template_id
    )
  }
}

const logListContext = ({
  shopId,
  rpcUrl,
  networkName
}: {
  shopId: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Shop")(shopId)
  console.log("")
}

const logItemListing = (itemListing: ItemListingSummary, index: number) => {
  logKeyValueGreen("Item")(index + 1)
  logKeyValueGreen("Object")(itemListing.itemListingId)
  logKeyValueGreen("Name")(itemListing.name ?? "Unknown")
  logKeyValueGreen("Item-type")(itemListing.itemType)
  logKeyValueGreen("USD-cents")(
    itemListing.basePriceUsdCents ?? "Unknown price"
  )
  logKeyValueGreen("Stock")(itemListing.stock ?? "Unknown stock")
  if (itemListing.spotlightTemplateId)
    logKeyValueGreen("Spotlight")(itemListing.spotlightTemplateId)
  logKeyValueGreen("Field-id")(itemListing.dynamicFieldObjectId)
  console.log("")
}
