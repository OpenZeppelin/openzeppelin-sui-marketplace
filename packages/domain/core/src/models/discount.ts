import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getAllDynamicFields,
  getSuiDynamicFieldObject
} from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  formatOptionalNumericValue,
  shortenId
} from "@sui-oracle-market/tooling-core/utils/formatters"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  unwrapMoveFields
} from "@sui-oracle-market/tooling-core/utils/move-values"
import { requireValue } from "@sui-oracle-market/tooling-core/utils/utility"
import type { ItemListingSummary } from "./item-listing.ts"
import { parseUsdToCents } from "./shop.ts"

export const DISCOUNT_TEMPLATE_TYPE_FRAGMENT = "::shop::DiscountTemplate"

export const discountRuleChoices = ["fixed", "percent"] as const

export type DiscountRuleKindLabel = (typeof discountRuleChoices)[number]

export type NormalizedRuleKind = 0 | 1

export type DiscountContext =
  | { mode: "none" }
  | {
      mode: "ticket"
      discountTicketId: string
      discountTemplateId: string
      ticketDetails: DiscountTicketDetails
    }
  | { mode: "claim"; discountTemplateId: string }

export const defaultStartTimestampSeconds = () => Math.floor(Date.now() / 1000)

export const parseDiscountRuleKind = (
  ruleKind: DiscountRuleKindLabel
): NormalizedRuleKind => {
  if (ruleKind === "fixed") return 0
  if (ruleKind === "percent") return 1
  throw new Error("ruleKind must be either fixed or percent.")
}

export const parseDiscountRuleValue = (
  ruleKind: NormalizedRuleKind,
  rawValue: string
): bigint =>
  ruleKind === 0
    ? parseUsdToCents(rawValue)
    : parsePercentToBasisPoints(rawValue)

export const parsePercentToBasisPoints = (rawPercent: string): bigint => {
  const normalized = rawPercent.trim()
  if (!normalized)
    throw new Error("A percent value is required for ruleKind=percent.")

  const percentMatch = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!percentMatch)
    throw new Error(
      "Percent discounts accept numeric input with up to two decimals (e.g., 12.5 for 12.50%)."
    )

  const wholePercent = BigInt(percentMatch[1])
  const fractional = percentMatch[2] ? percentMatch[2].padEnd(2, "0") : "00"
  const basisPoints = wholePercent * 100n + BigInt(fractional)

  if (basisPoints > 10_000n)
    throw new Error("Percent discount cannot exceed 100.00%.")

  return basisPoints
}

export const validateDiscountSchedule = (
  startsAt: bigint,
  expiresAt?: bigint
) => {
  if (expiresAt !== undefined && expiresAt <= startsAt)
    throw new Error("expiresAt must be greater than startsAt.")
}

export const describeRuleKind = (ruleKind: NormalizedRuleKind): string =>
  ruleKind === 0 ? "fixed" : "percent"

export const formatRuleValue = (
  ruleKind: NormalizedRuleKind,
  ruleValue: bigint
): string => {
  if (ruleKind === 0) return `${ruleValue.toString()} cents`

  const percentage = Number(ruleValue) / 100
  return `${percentage.toFixed(2)}%`
}

export const normalizeOptionalU64FromValue = (
  value: unknown
): bigint | undefined => normalizeBigIntFromMoveValue(value)

export type DiscountRuleOnChain =
  | { kind: "fixed"; amountCents?: bigint }
  | { kind: "percent"; basisPoints?: bigint }
  | { kind: "unknown"; raw: unknown }

const pickVariantPayload = (
  container: Record<string, unknown>,
  variantKeys: string[]
): unknown => {
  for (const key of variantKeys) {
    if (key in container) return container[key]
  }

  return undefined
}

const parseFixedRule = (payload: unknown): DiscountRuleOnChain => {
  const payloadFields = unwrapMoveFields(payload)
  const amountValue = payloadFields
    ? extractFieldValueByKeys(payloadFields, [
        "amount_cents",
        "amount",
        "usd_cents"
      ])
    : payload

  return {
    kind: "fixed",
    amountCents: normalizeBigIntFromMoveValue(amountValue)
  }
}

const parsePercentRule = (payload: unknown): DiscountRuleOnChain => {
  const payloadFields = unwrapMoveFields(payload)
  const bpsValue = payloadFields
    ? extractFieldValueByKeys(payloadFields, ["bps", "basis_points"])
    : payload

  return {
    kind: "percent",
    basisPoints: normalizeBigIntFromMoveValue(bpsValue)
  }
}

const extractRuleKindFromType = (ruleType?: string) => {
  if (!ruleType) return undefined

  if (ruleType.toLowerCase().includes("percent")) return "percent" as const
  if (ruleType.toLowerCase().includes("fixed")) return "fixed" as const
  return undefined
}

export const parseDiscountRuleFromField = (
  ruleField: unknown
): DiscountRuleOnChain => {
  const ruleRecord = unwrapMoveFields(ruleField) ?? {}
  const ruleType =
    typeof (ruleField as { type?: string })?.type === "string"
      ? (ruleField as { type?: string }).type
      : undefined

  const fixedPayload = pickVariantPayload(ruleRecord, ["Fixed", "fixed"])
  if (fixedPayload !== undefined) return parseFixedRule(fixedPayload)

  const percentPayload = pickVariantPayload(ruleRecord, ["Percent", "percent"])
  if (percentPayload !== undefined) return parsePercentRule(percentPayload)

  if ("amount_cents" in ruleRecord) return parseFixedRule(ruleRecord)
  if ("bps" in ruleRecord || "basis_points" in ruleRecord)
    return parsePercentRule(ruleRecord)

  const inferredKind = extractRuleKindFromType(ruleType)
  if (inferredKind === "fixed") return parseFixedRule(ruleRecord)
  if (inferredKind === "percent") return parsePercentRule(ruleRecord)

  return { kind: "unknown", raw: ruleField }
}

export const centsToUnit = (cents: number | string) =>
  Number.isInteger(Number(cents)) && Number(cents) >= 0
    ? Number(cents) / 100
    : (() => {
        throw new TypeError("cents must be a non-negative integer")
      })()

export const formatOnChainDiscountRule = (
  discountRule: DiscountRuleOnChain
): string => {
  if (discountRule.kind === "fixed")
    return discountRule.amountCents !== undefined
      ? `${centsToUnit(discountRule.amountCents.toString())}$ off`
      : "Fixed discount (amount unknown)"

  if (discountRule.kind === "percent") {
    if (discountRule.basisPoints === undefined)
      return "Percent discount (bps unknown)"

    const percentage = Number(discountRule.basisPoints) / 100
    return `${percentage.toFixed(2)}% off`
  }

  return "Unknown rule"
}

export const deriveTemplateStatus = ({
  activeFlag,
  startsAt,
  expiresAt,
  maxRedemptions,
  redemptions
}: {
  activeFlag: boolean
  startsAt?: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  redemptions?: bigint
}): string => {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const isScheduled = startsAt !== undefined && now < startsAt
  const isExpired = expiresAt !== undefined && now >= expiresAt
  const redemptionCapReached =
    maxRedemptions !== undefined &&
    maxRedemptions > 0n &&
    redemptions !== undefined &&
    redemptions >= maxRedemptions

  if (!activeFlag) return "disabled"
  if (isExpired) return "expired"
  if (redemptionCapReached) return "maxed"
  if (isScheduled) return "scheduled"

  return "active"
}

export type DiscountTemplateSummary = {
  discountTemplateId: string
  markerObjectId: string
  shopAddress: string
  appliesToListingId?: string
  ruleDescription: string
  ruleKind?: DiscountRuleOnChain["kind"]
  ruleValue?: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
  claimsIssued?: string
  redemptions?: string
  activeFlag: boolean
  status: string
}

/**
 * Builds a lookup map for discount templates by ID.
 */
export const buildDiscountTemplateLookup = (
  templates: DiscountTemplateSummary[]
) =>
  templates.reduce<Record<string, DiscountTemplateSummary>>(
    (accumulator, template) => ({
      ...accumulator,
      [template.discountTemplateId]: template
    }),
    {}
  )

export type DiscountOption = {
  id: string
  label: string
  description?: string
  status?: string
  disabled?: boolean
  selection: DiscountContext
}

export const pickDefaultDiscountOptionId = (options: DiscountOption[]) => {
  const enabledOptions = options.filter((option) => !option.disabled)
  return enabledOptions[0]?.id ?? "none"
}

export const buildDiscountOptions = ({
  listing,
  shopId,
  discountTemplates,
  discountTickets
}: {
  listing?: ItemListingSummary
  shopId?: string
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
}): DiscountOption[] => {
  if (!listing || !shopId) return []
  const templateLookup = buildDiscountTemplateLookup(discountTemplates)
  const spotlightTemplate = listing.spotlightTemplateId
    ? templateLookup[listing.spotlightTemplateId]
    : undefined

  const eligibleTickets = discountTickets.filter((ticket) => {
    if (ticket.shopAddress !== shopId) return false
    if (ticket.listingId && ticket.listingId !== listing.itemListingId)
      return false

    const template = templateLookup[ticket.discountTemplateId]
    if (
      template?.appliesToListingId &&
      template.appliesToListingId !== listing.itemListingId
    )
      return false

    return true
  })

  const ticketOptions: DiscountOption[] = eligibleTickets.map((ticket) => {
    const template = templateLookup[ticket.discountTemplateId]
    const status = template?.status
    const isActive = status ? status === "active" : true

    return {
      id: `ticket:${ticket.discountTicketId}`,
      label: template?.ruleDescription || "Discount ticket",
      description: `Use ticket ${shortenId(ticket.discountTicketId)}${
        ticket.listingId ? " for this listing" : ""
      }.`,
      status,
      disabled: !isActive,
      selection: {
        mode: "ticket",
        discountTicketId: ticket.discountTicketId,
        discountTemplateId: ticket.discountTemplateId,
        ticketDetails: ticket
      }
    }
  })

  const claimOption: DiscountOption[] =
    spotlightTemplate &&
    spotlightTemplate.status === "active" &&
    !eligibleTickets.some(
      (ticket) =>
        ticket.discountTemplateId === spotlightTemplate.discountTemplateId
    )
      ? [
          {
            id: "claim",
            label: spotlightTemplate.ruleDescription,
            description:
              "Claim a single-use ticket and redeem it in the same transaction.",
            status: spotlightTemplate.status,
            selection: {
              mode: "claim",
              discountTemplateId: spotlightTemplate.discountTemplateId
            }
          }
        ]
      : []

  return [
    {
      id: "none",
      label: "No discount",
      description: "Checkout without a discount ticket.",
      selection: { mode: "none" }
    },
    ...ticketOptions,
    ...claimOption
  ]
}

export const getDiscountTemplateSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateSummary[]> => {
  const discountTemplateMarkers = await getAllDynamicFields(
    {
      parentObjectId: shopId,
      objectTypeFilter: DISCOUNT_TEMPLATE_MARKER_TYPE_FRAGMENT
    },
    { suiClient }
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
        { suiClient }
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

export const getDiscountTemplateSummary = async (
  shopId: string,
  discountTemplateId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateSummary> => {
  const { object } = await getSuiObject(
    {
      objectId: discountTemplateId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )
  const marker = await getSuiDynamicFieldObject(
    { parentObjectId: shopId, childObjectId: discountTemplateId },
    { suiClient }
  )

  return buildDiscountTemplateSummary(
    object,
    discountTemplateId,
    marker.dynamicFieldId
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
    ruleKind: rule.kind,
    ruleValue:
      rule.kind === "fixed"
        ? formatOptionalNumericValue(rule.amountCents)
        : rule.kind === "percent"
          ? formatOptionalNumericValue(rule.basisPoints)
          : undefined,
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

export const DISCOUNT_TICKET_TYPE_FRAGMENT = "::shop::DiscountTicket"
export const DISCOUNT_TEMPLATE_MARKER_TYPE_FRAGMENT =
  "::shop::DiscountTemplateMarker"

export const formatDiscountTicketStructType = (packageId: string): string =>
  `${normalizeSuiObjectId(packageId)}${DISCOUNT_TICKET_TYPE_FRAGMENT}`

export type DiscountTicketDetails = {
  discountTicketId: string
  discountTemplateId: string
  shopAddress: string
  listingId?: string
  claimer: string
}

export const parseDiscountTicketFromObject = (
  discountTicketObject: SuiObjectData
): DiscountTicketDetails => {
  const discountTicketId = normalizeIdOrThrow(
    discountTicketObject.objectId,
    "DiscountTicket object is missing an id."
  )

  const discountTicketFields = unwrapMoveObjectFields<{
    discount_template_id: unknown
    shop_address: unknown
    listing_id: unknown
    claimer: unknown
  }>(discountTicketObject)

  const listingId = normalizeOptionalIdFromValue(
    discountTicketFields.listing_id
  )

  return {
    discountTicketId,
    discountTemplateId: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.discount_template_id),
      `Missing discount_template_id for DiscountTicket ${discountTicketId}.`
    ),
    shopAddress: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.shop_address),
      `Missing shop_address for DiscountTicket ${discountTicketId}.`
    ),
    listingId: listingId ? normalizeSuiObjectId(listingId) : undefined,
    claimer: requireValue(
      normalizeOptionalAddress(
        discountTicketFields.claimer as string | undefined
      ),
      `Missing claimer for DiscountTicket ${discountTicketId}.`
    )
  }
}

type CreatedObjectLike = {
  objectType?: string | null
  objectId?: string | null
}

export const findCreatedDiscountTicketId = (
  createdObjects: CreatedObjectLike[]
) =>
  createdObjects.find((object) =>
    object.objectType?.includes(DISCOUNT_TICKET_TYPE_FRAGMENT)
  )?.objectId || undefined

/**
 * Lists DiscountTicket objects owned by an address with optional shop filtering.
 */
export const getDiscountTicketSummaries = async ({
  ownerAddress,
  shopPackageId,
  shopFilterId,
  suiClient
}: {
  ownerAddress: string
  shopPackageId: string
  shopFilterId?: string
  suiClient: SuiClient
}): Promise<DiscountTicketDetails[]> => {
  const discountTicketStructType = formatDiscountTicketStructType(shopPackageId)

  const discountTicketObjects = await getAllOwnedObjectsByFilter(
    {
      ownerAddress,
      filter: { StructType: discountTicketStructType }
    },
    { suiClient }
  )

  const discountTickets = discountTicketObjects.map(
    parseDiscountTicketFromObject
  )

  if (!shopFilterId) return discountTickets

  const normalizedShopFilterId = normalizeIdOrThrow(
    shopFilterId,
    "Invalid shop id provided for filtering."
  )

  return discountTickets.filter(
    (discountTicket) => discountTicket.shopAddress === normalizedShopFilterId
  )
}
