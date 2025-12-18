import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import {
  deriveTemplateStatus,
  formatOnChainDiscountRule,
  normalizeOptionalU64FromValue,
  parseDiscountRuleFromField
} from "../../models/discount.ts"
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
import { formatOptionalNumericValue } from "../../utils/formatters.ts"

type ListDiscountTemplatesArguments = {
  shopId?: string
}

type DiscountTemplateSummary = {
  discountTemplateId: string
  markerObjectId: string
  shopAddress: string
  appliesToListingId?: string
  ruleDescription: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
  claimsIssued?: string
  redemptions?: string
  activeFlag: boolean
  status: string
}

const DISCOUNT_TEMPLATE_MARKER_TYPE_FRAGMENT = "::shop::DiscountTemplateMarker"

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const { shopId } = await resolveInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })

    logListContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const discountTemplates = await fetchDiscountTemplates(shopId, suiClient)
    if (discountTemplates.length === 0) {
      logKeyValueYellow("Discount-templates")("No templates found.")
      return
    }

    discountTemplates.forEach((template, index) =>
      logDiscountTemplate(template, index + 1)
    )
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
  cliArguments: ListDiscountTemplatesArguments,
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

const fetchDiscountTemplates = async (
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateSummary[]> => {
  const dynamicFields = await fetchAllDynamicFields(
    { parentObjectId: shopId },
    suiClient
  )
  const discountTemplateMarkers = dynamicFields.filter((dynamicField) =>
    dynamicField.objectType?.includes(DISCOUNT_TEMPLATE_MARKER_TYPE_FRAGMENT)
  )

  if (discountTemplateMarkers.length === 0) return []

  const discountTemplateIds = discountTemplateMarkers.map((marker) =>
    normalizeIdOrThrow(
      normalizeOptionalIdFromValue((marker.name as { value: string })?.value),
      `Missing DiscountTemplate id for dynamic field ${marker.objectId}.`
    )
  )

  const discountTemplateObjects = await Promise.all(
    discountTemplateIds.map((discountTemplateId) =>
      getSuiObject(
        {
          objectId: discountTemplateId,
          options: { showContent: true, showType: true }
        },
        suiClient
      )
    )
  )

  return discountTemplateObjects.map((response, index) =>
    buildDiscountTemplateSummary(
      response.object,
      discountTemplateIds[index],
      discountTemplateMarkers[index].objectId
    )
  )
}

const buildDiscountTemplateSummary = (
  discountTemplateObject: SuiObjectData,
  discountTemplateId: string,
  markerObjectId: string
): DiscountTemplateSummary => {
  const discountTemplateFields = unwrapMoveObjectFields(discountTemplateObject)
  const shopAddress = normalizeOptionalIdFromValue(
    discountTemplateFields.shop_address
  )
  const appliesToListingId = normalizeOptionalIdFromValue(
    discountTemplateFields.applies_to_listing
  )

  const rule = parseDiscountRuleFromField(discountTemplateFields.rule)
  const startsAt = normalizeOptionalU64FromValue(
    discountTemplateFields.starts_at
  )
  const expiresAt = normalizeOptionalU64FromValue(
    discountTemplateFields.expires_at
  )
  const maxRedemptions = normalizeOptionalU64FromValue(
    discountTemplateFields.max_redemptions
  )
  const claimsIssued = normalizeOptionalU64FromValue(
    discountTemplateFields.claims_issued
  )
  const redemptions = normalizeOptionalU64FromValue(
    discountTemplateFields.redemptions
  )
  const activeFlag = Boolean(discountTemplateFields.active)

  return {
    discountTemplateId,
    markerObjectId,
    shopAddress: normalizeIdOrThrow(
      shopAddress,
      `Missing shop_address for DiscountTemplate ${discountTemplateId}.`
    ),
    appliesToListingId,
    ruleDescription: formatOnChainDiscountRule(rule),
    startsAt: formatOptionalNumericValue(startsAt),
    expiresAt: formatOptionalNumericValue(expiresAt),
    maxRedemptions:
      maxRedemptions === undefined
        ? undefined
        : formatOptionalNumericValue(maxRedemptions),
    claimsIssued: formatOptionalNumericValue(claimsIssued),
    redemptions: formatOptionalNumericValue(redemptions),
    activeFlag,
    status: deriveTemplateStatus({
      activeFlag,
      startsAt,
      expiresAt,
      maxRedemptions,
      redemptions
    })
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

const logDiscountTemplate = (
  discountTemplate: DiscountTemplateSummary,
  index: number
) => {
  logKeyValueGreen("Template")(index)
  logKeyValueGreen("Object")(discountTemplate.discountTemplateId)
  logKeyValueGreen("Status")(discountTemplate.status)
  logKeyValueGreen("Active-flag")(discountTemplate.activeFlag)
  logKeyValueGreen("Shop")(discountTemplate.shopAddress)
  if (discountTemplate.appliesToListingId)
    logKeyValueGreen("Listing")(discountTemplate.appliesToListingId)
  else logKeyValueGreen("Listing")("Reusable across listings")
  logKeyValueGreen("Rule")(discountTemplate.ruleDescription)
  logKeyValueGreen("Starts-at")(discountTemplate.startsAt ?? "Unknown start")
  if (discountTemplate.expiresAt)
    logKeyValueGreen("Expires-at")(discountTemplate.expiresAt)
  else logKeyValueGreen("Expires-at")("No expiry")
  if (discountTemplate.maxRedemptions)
    logKeyValueGreen("Max-redemptions")(discountTemplate.maxRedemptions)
  else logKeyValueGreen("Max-redemptions")("Unlimited")
  logKeyValueGreen("Claims")(discountTemplate.claimsIssued ?? "Unknown")
  logKeyValueGreen("Redeemed")(discountTemplate.redemptions ?? "Unknown")
  logKeyValueGreen("Marker-id")(discountTemplate.markerObjectId)
  console.log("")
}
