import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  getSuiObject,
  normalizeIdOrThrow,
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
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import type { ItemListingSummary } from "./item-listing.ts"
import { normalizeOptionalListingIdFromValue } from "./item-listing.ts"
import { parseUsdToCents } from "./shop.ts"

export const DISCOUNT_TYPE_FRAGMENT = "::discount::Discount"
export const DISCOUNT_CREATED_EVENT_TYPE_FRAGMENT = "::events::DiscountCreated"
const SHOP_DISCOUNTS_FIELD = "discounts"

export const discountRuleChoices = ["fixed", "percent"] as const

export type DiscountRuleKindLabel = (typeof discountRuleChoices)[number]

export type NormalizedRuleKind = 0 | 1

export type DiscountContext =
  | { mode: "none" }
  | { mode: "discount"; discountId: string }

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

export const extractDiscountIdFromCreatedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string | undefined => {
  const normalizedShopId = normalizeSuiObjectId(shopId)
  const discountCreatedEvent = events?.find((event) => {
    if (!event.type.endsWith(DISCOUNT_CREATED_EVENT_TYPE_FRAGMENT)) return false
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
    !discountCreatedEvent?.parsedJson ||
    typeof discountCreatedEvent.parsedJson !== "object" ||
    Array.isArray(discountCreatedEvent.parsedJson)
  )
    return undefined

  const eventFields = discountCreatedEvent.parsedJson as Record<string, unknown>
  return normalizeOptionalIdFromValue(eventFields.discount_id)
}

export const extractDiscountTableEntryFieldIdFromCreatedObjects = ({
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
        createdObject.objectType.includes(DISCOUNT_TYPE_FRAGMENT)
    )?.objectId
  )

export const requireDiscountIdFromCreatedEvents = ({
  events,
  shopId
}: {
  events: { type: string; parsedJson?: unknown }[] | null | undefined
  shopId: string
}): string => {
  const discountId = extractDiscountIdFromCreatedEvents({
    events,
    shopId
  })
  if (!discountId)
    throw new Error(
      "Expected a DiscountCreated event for this shop, but it was not found."
    )

  return discountId
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

export const deriveDiscountStatus = ({
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

export type DiscountSummary = {
  discountId: string
  tableEntryFieldId: string
  shopId: string
  appliesToListingId?: string
  ruleDescription: string
  ruleKind?: DiscountRuleOnChain["kind"]
  ruleValue?: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
  redemptions?: string
  activeFlag: boolean
  status: string
}

type DiscountTableEntryField = Awaited<
  ReturnType<typeof getTableEntryDynamicFields>
>[number]

type OrderedDiscountTableEntry = {
  tableEntryField: DiscountTableEntryField
  discountId: string
}

/**
 * Builds a lookup map for discounts by ID.
 */
export const buildDiscountLookup = (
  discountSummaries: DiscountSummary[]
): Record<string, DiscountSummary> =>
  Object.fromEntries(
    discountSummaries.map((discountSummary) => [
      discountSummary.discountId,
      discountSummary
    ])
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
  discounts
}: {
  listing?: ItemListingSummary
  shopId?: string
  discounts: DiscountSummary[]
}): DiscountOption[] => {
  if (!listing || !shopId) return []
  const eligibleDiscounts = discounts
    .filter((discountSummary) => {
      if (discountSummary.shopId !== normalizeSuiObjectId(shopId)) return false
      if (
        discountSummary.appliesToListingId &&
        discountSummary.appliesToListingId !== listing.itemListingId
      )
        return false
      return true
    })
    .sort((leftDiscount, rightDiscount) =>
      leftDiscount.discountId.localeCompare(rightDiscount.discountId)
    )

  const discountOptions: DiscountOption[] = eligibleDiscounts.map(
    (discountSummary) => {
      const isActive = discountSummary.status === "active"
      return {
        id: `discount:${discountSummary.discountId}`,
        label: discountSummary.ruleDescription,
        description: discountSummary.appliesToListingId
          ? `Applies to listing ${shortenId(discountSummary.appliesToListingId)}.`
          : "Applies to all listings.",
        status: discountSummary.status,
        disabled: !isActive,
        selection: {
          mode: "discount",
          discountId: discountSummary.discountId
        }
      }
    }
  )

  return [
    {
      id: "none",
      label: "No discount",
      description: "Checkout without a discount.",
      selection: { mode: "none" }
    },
    ...discountOptions
  ]
}

export const getDiscountSummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<DiscountSummary[]> => {
  const { normalizedShopId, discountsTableObjectId } =
    await getDiscountsTableObjectId({
      shopId,
      suiClient
    })
  const discountTableEntryFields = await getTableEntryDynamicFields(
    {
      tableObjectId: discountsTableObjectId,
      objectTypeFilter: DISCOUNT_TYPE_FRAGMENT
    },
    { suiClient }
  )

  if (discountTableEntryFields.length === 0) return []

  const orderedTableEntries: OrderedDiscountTableEntry[] =
    discountTableEntryFields
      .map((tableEntryField) => ({
        tableEntryField,
        discountId: normalizeIdOrThrow(
          normalizeOptionalIdFromValue(tableEntryField.name.value),
          `Missing Discount id for table entry ${tableEntryField.objectId}.`
        )
      }))
      .sort((leftEntry, rightEntry) =>
        leftEntry.discountId.localeCompare(rightEntry.discountId)
      )

  return Promise.all(
    orderedTableEntries.map((orderedTableEntry) =>
      getDiscountSummaryFromOrderedTableEntry({
        orderedTableEntry,
        shopId: normalizedShopId,
        suiClient
      })
    )
  )
}

export const getDiscountSummary = async (
  shopId: string,
  discountId: string,
  suiClient: SuiClient
): Promise<DiscountSummary> => {
  const { normalizedShopId, discountsTableObjectId } =
    await getDiscountsTableObjectId({
      shopId,
      suiClient
    })
  const normalizedDiscountId = normalizeSuiObjectId(discountId)
  const discountTableEntryObject = await getTableEntryDynamicFieldObject(
    {
      tableObjectId: discountsTableObjectId,
      keyType: TABLE_KEY_TYPE_OBJECT_ID,
      keyValue: normalizedDiscountId
    },
    { suiClient }
  )

  if (!discountTableEntryObject)
    throw new Error(
      `No Discount ${normalizedDiscountId} found for shop ${normalizedShopId}.`
    )

  return buildDiscountSummary(
    discountTableEntryObject,
    normalizedDiscountId,
    normalizeIdOrThrow(
      discountTableEntryObject.objectId,
      `Missing table entry id for Discount ${normalizedDiscountId}.`
    ),
    normalizedShopId
  )
}

const getDiscountsTableObjectId = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}): Promise<{
  normalizedShopId: string
  discountsTableObjectId: string
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
    discountsTableObjectId: resolveTableObjectIdFromField({
      object: shopObject,
      fieldName: SHOP_DISCOUNTS_FIELD
    })
  }
}

const getDiscountSummaryFromOrderedTableEntry = async ({
  orderedTableEntry,
  shopId,
  suiClient
}: {
  orderedTableEntry: OrderedDiscountTableEntry
  shopId: string
  suiClient: SuiClient
}): Promise<DiscountSummary> => {
  const { object } = await getSuiObject(
    {
      objectId: orderedTableEntry.tableEntryField.objectId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return buildDiscountSummary(
    object,
    orderedTableEntry.discountId,
    orderedTableEntry.tableEntryField.objectId,
    shopId
  )
}

const buildDiscountSummary = (
  discountTableEntryObject: SuiObjectData,
  discountId: string,
  tableEntryFieldId: string,
  shopId: string
): DiscountSummary => {
  const discountFields = unwrapMoveObjectFields(discountTableEntryObject)
  const appliesToListingId = normalizeOptionalListingIdFromValue(
    discountFields.applies_to_listing
  )

  const rule = parseDiscountRuleFromField(discountFields.rule)
  const startsAt = normalizeOptionalU64FromValue(discountFields.starts_at)
  const expiresAt = normalizeOptionalU64FromValue(discountFields.expires_at)
  const maxRedemptions = normalizeOptionalU64FromValue(
    discountFields.max_redemptions
  )
  const redemptions = normalizeOptionalU64FromValue(discountFields.redemptions)
  const activeFlag = Boolean(discountFields.active)

  return {
    discountId,
    tableEntryFieldId,
    shopId,
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
    redemptions: formatOptionalNumericValue(redemptions),
    activeFlag,
    status: deriveDiscountStatus({
      activeFlag,
      startsAt,
      expiresAt,
      maxRedemptions,
      redemptions
    })
  }
}
