import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  TABLE_KEY_TYPE_OBJECT_ID,
  getTableEntryDynamicFieldObject,
  getTableEntryDynamicFields,
  resolveTableObjectIdFromField
} from "@sui-oracle-market/tooling-core/table"
import {
  formatOptionalNumericValue,
  shortenId
} from "@sui-oracle-market/tooling-core/utils/formatters"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  unwrapMoveFields
} from "@sui-oracle-market/tooling-core/utils/move-values"
import {
  parseNonNegativeU64,
  parseOptionalU64,
  requireValue
} from "@sui-oracle-market/tooling-core/utils/utility"
import type { ItemListingSummary } from "./item-listing.ts"
import { normalizeOptionalListingIdFromValue } from "./item-listing.ts"
import { parseUsdToCents } from "./shop.ts"

export const DISCOUNT_TEMPLATE_TYPE_FRAGMENT = "::shop::DiscountTemplate"
export const DISCOUNT_TEMPLATE_CREATED_EVENT_TYPE_FRAGMENT =
  "::shop::DiscountTemplateCreatedEvent"
const SHOP_DISCOUNT_TEMPLATES_FIELD = "discount_templates"

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

export const parseDiscountRuleScheduleStringInputs = ({
  ruleKind,
  value,
  startsAt,
  expiresAt,
  maxRedemptions,
  startsAtLabel = "startsAt",
  expiresAtLabel = "expiresAt",
  maxRedemptionsLabel = "maxRedemptions"
}: {
  ruleKind: DiscountRuleKindLabel
  value: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
  startsAtLabel?: string
  expiresAtLabel?: string
  maxRedemptionsLabel?: string
}): {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
} => {
  const normalizedRuleKind = parseDiscountRuleKind(ruleKind)
  const normalizedStartsAt = parseNonNegativeU64(
    startsAt ?? defaultStartTimestampSeconds().toString(),
    startsAtLabel
  )
  const normalizedExpiresAt = parseOptionalU64(expiresAt, expiresAtLabel)
  validateDiscountSchedule(normalizedStartsAt, normalizedExpiresAt)

  return {
    ruleKind: normalizedRuleKind,
    ruleValue: parseDiscountRuleValue(normalizedRuleKind, value),
    startsAt: normalizedStartsAt,
    expiresAt: normalizedExpiresAt,
    maxRedemptions: parseOptionalU64(maxRedemptions, maxRedemptionsLabel)
  }
}

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

export const extractDiscountTemplateIdFromCreatedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string | undefined => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const discountTemplateCreatedEvent = events?.find((event) => {
    if (!event.type.endsWith(DISCOUNT_TEMPLATE_CREATED_EVENT_TYPE_FRAGMENT))
      return false
    if (
      !event.parsedJson ||
      typeof event.parsedJson !== "object" ||
      Array.isArray(event.parsedJson)
    )
      return false

    const eventFields = event.parsedJson as Record<string, unknown>
    return (
      normalizeOptionalIdFromValue(eventFields.shop_id) === normalizedShopId
    )
  })

  if (
    !discountTemplateCreatedEvent?.parsedJson ||
    typeof discountTemplateCreatedEvent.parsedJson !== "object" ||
    Array.isArray(discountTemplateCreatedEvent.parsedJson)
  )
    return undefined

  const eventFields = discountTemplateCreatedEvent.parsedJson as Record<
    string,
    unknown
  >
  return normalizeOptionalIdFromValue(eventFields.discount_template_id)
}

export const extractDiscountTemplateTableEntryFieldIdFromCreatedObjects = ({
  createdObjects
}: {
  createdObjects:
    | Array<{
        objectId: string
        objectType: string
      }>
    | null
    | undefined
}): string | undefined =>
  normalizeOptionalIdFromValue(
    createdObjects?.find(
      (createdObject) =>
        createdObject.objectType.includes("::Field<0x2::object::ID,") &&
        createdObject.objectType.includes(DISCOUNT_TEMPLATE_TYPE_FRAGMENT)
    )?.objectId
  )

export const requireDiscountTemplateIdFromCreatedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string => {
  const discountTemplateId = extractDiscountTemplateIdFromCreatedEvents({
    events,
    shopId
  })
  if (!discountTemplateId)
    throw new Error(
      "Expected a DiscountTemplateCreatedEvent for this shop, but it was not found."
    )

  return discountTemplateId
}

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
  tableEntryFieldId: string
  shopId: string
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

type DiscountTemplateTableEntryField = Awaited<
  ReturnType<typeof getTableEntryDynamicFields>
>[number]

type OrderedDiscountTemplateTableEntry = {
  tableEntryField: DiscountTemplateTableEntryField
  discountTemplateId: string
}

/**
 * Builds a lookup map for discount templates by ID.
 */
export const buildDiscountTemplateLookup = (
  templates: DiscountTemplateSummary[]
): Record<string, DiscountTemplateSummary> =>
  Object.fromEntries(
    templates.map((template) => [template.discountTemplateId, template])
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
    if (ticket.shopId !== shopId) return false
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
  const { discountTemplatesTableObjectId } =
    await getDiscountTemplatesTableObjectId({
      shopId,
      suiClient
    })
  const discountTemplateTableEntryFields = await getTableEntryDynamicFields(
    {
      tableObjectId: discountTemplatesTableObjectId,
      objectTypeFilter: DISCOUNT_TEMPLATE_TYPE_FRAGMENT
    },
    { suiClient }
  )

  if (discountTemplateTableEntryFields.length === 0) return []

  const orderedTableEntries: OrderedDiscountTemplateTableEntry[] =
    discountTemplateTableEntryFields
      .map((tableEntryField) => ({
        tableEntryField,
        discountTemplateId: normalizeIdOrThrow(
          normalizeOptionalIdFromValue(tableEntryField.name.value),
          `Missing DiscountTemplate id for table entry ${tableEntryField.objectId}.`
        )
      }))
      .sort((leftEntry, rightEntry) =>
        leftEntry.discountTemplateId.localeCompare(
          rightEntry.discountTemplateId
        )
      )

  return Promise.all(
    orderedTableEntries.map((orderedTableEntry) =>
      getDiscountTemplateSummaryFromOrderedTableEntry({
        orderedTableEntry,
        suiClient
      })
    )
  )
}

export const getDiscountTemplateSummary = async (
  shopId: string,
  discountTemplateId: string,
  suiClient: SuiClient
): Promise<DiscountTemplateSummary> => {
  const { normalizedShopId, discountTemplatesTableObjectId } =
    await getDiscountTemplatesTableObjectId({
      shopId,
      suiClient
    })
  const normalizedDiscountTemplateId = normalizeSuiObjectId(discountTemplateId)
  const discountTemplateTableEntryObject =
    await getTableEntryDynamicFieldObject(
      {
        tableObjectId: discountTemplatesTableObjectId,
        keyType: TABLE_KEY_TYPE_OBJECT_ID,
        keyValue: normalizedDiscountTemplateId
      },
      { suiClient }
    )

  if (!discountTemplateTableEntryObject)
    throw new Error(
      `No DiscountTemplate ${normalizedDiscountTemplateId} found for shop ${normalizedShopId}.`
    )

  return buildDiscountTemplateSummary(
    discountTemplateTableEntryObject,
    normalizedDiscountTemplateId,
    normalizeIdOrThrow(
      discountTemplateTableEntryObject.objectId,
      `Missing table entry id for DiscountTemplate ${normalizedDiscountTemplateId}.`
    )
  )
}

const getDiscountTemplatesTableObjectId = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}): Promise<{
  normalizedShopId: string
  discountTemplatesTableObjectId: string
}> => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const { object: shopObject } = await getSuiObject(
    {
      objectId: normalizedShopId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return {
    normalizedShopId,
    discountTemplatesTableObjectId: resolveTableObjectIdFromField({
      object: shopObject,
      fieldName: SHOP_DISCOUNT_TEMPLATES_FIELD
    })
  }
}

const getDiscountTemplateSummaryFromOrderedTableEntry = async ({
  orderedTableEntry,
  suiClient
}: {
  orderedTableEntry: OrderedDiscountTemplateTableEntry
  suiClient: SuiClient
}): Promise<DiscountTemplateSummary> => {
  const { object } = await getSuiObject(
    {
      objectId: orderedTableEntry.tableEntryField.objectId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return buildDiscountTemplateSummary(
    object,
    orderedTableEntry.discountTemplateId,
    orderedTableEntry.tableEntryField.objectId
  )
}

const buildDiscountTemplateSummary = (
  discountTemplateTableEntryObject: SuiObjectData,
  discountTemplateId: string,
  tableEntryFieldId: string
): DiscountTemplateSummary => {
  const discountTemplateFields = unwrapMoveObjectFields(
    discountTemplateTableEntryObject
  )
  const shopId = normalizeOptionalIdFromValue(discountTemplateFields.shop_id)
  const appliesToListingId = normalizeOptionalListingIdFromValue(
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
    tableEntryFieldId,
    shopId: normalizeIdOrThrow(
      shopId,
      `Missing shop_id for DiscountTemplate ${discountTemplateId}.`
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

export const formatDiscountTicketStructType = (packageId: string): string =>
  `${normalizeSuiObjectId(packageId)}${DISCOUNT_TICKET_TYPE_FRAGMENT}`

export type DiscountTicketDetails = {
  discountTicketId: string
  discountTemplateId: string
  shopId: string
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
    shop_id: unknown
    listing_id: unknown
    claimer: unknown
  }>(discountTicketObject)

  const listingId = normalizeOptionalListingIdFromValue(
    discountTicketFields.listing_id
  )

  return {
    discountTicketId,
    discountTemplateId: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.discount_template_id),
      `Missing discount_template_id for DiscountTicket ${discountTicketId}.`
    ),
    shopId: normalizeIdOrThrow(
      normalizeOptionalIdFromValue(discountTicketFields.shop_id),
      `Missing shop_id for DiscountTicket ${discountTicketId}.`
    ),
    listingId,
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
    (discountTicket) => discountTicket.shopId === normalizedShopFilterId
  )
}
