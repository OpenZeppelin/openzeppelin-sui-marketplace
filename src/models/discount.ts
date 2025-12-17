import { tryParseBigInt } from "../utils/utility.ts"
import { parseUsdToCents } from "./shop.ts"

export const DISCOUNT_TEMPLATE_TYPE_FRAGMENT = "::shop::DiscountTemplate"

export const discountRuleChoices = ["fixed", "percent"] as const

export type DiscountRuleKindLabel = (typeof discountRuleChoices)[number]

export type NormalizedRuleKind = 0 | 1

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

const unwrapFields = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  if (record.fields && typeof record.fields === "object")
    return record.fields as Record<string, unknown>

  return record
}

const unwrapOptionValue = (value: unknown): unknown => {
  const record = unwrapFields(value)
  if (!record) return value

  if ("some" in record) return (record as { some: unknown }).some
  if ("none" in record) return undefined

  return value
}

const normalizeBigIntFromValue = (value: unknown): bigint | undefined => {
  const unwrappedValue = unwrapOptionValue(value)
  if (unwrappedValue === undefined || unwrappedValue === null) return undefined

  if (typeof unwrappedValue === "bigint") return unwrappedValue
  if (typeof unwrappedValue === "number") return BigInt(unwrappedValue)
  if (typeof unwrappedValue === "string") {
    try {
      return tryParseBigInt(unwrappedValue)
    } catch {
      return undefined
    }
  }

  const nestedFields = unwrapFields(unwrappedValue)
  if (!nestedFields) return undefined

  const nestedFieldValues = Object.values(nestedFields)
  if (nestedFieldValues.length === 1)
    return normalizeBigIntFromValue(nestedFieldValues[0])

  return undefined
}

export const normalizeOptionalU64FromValue = (
  value: unknown
): bigint | undefined => normalizeBigIntFromValue(value)

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

const extractFieldByKeys = (
  container: Record<string, unknown>,
  candidateKeys: string[]
): unknown => {
  for (const key of candidateKeys) {
    if (key in container) return container[key]
  }

  return undefined
}

const parseFixedRule = (payload: unknown): DiscountRuleOnChain => {
  const payloadFields = unwrapFields(payload)
  const amountValue = payloadFields
    ? extractFieldByKeys(payloadFields, ["amount_cents", "amount", "usd_cents"])
    : payload

  return {
    kind: "fixed",
    amountCents: normalizeBigIntFromValue(amountValue)
  }
}

const parsePercentRule = (payload: unknown): DiscountRuleOnChain => {
  const payloadFields = unwrapFields(payload)
  const bpsValue = payloadFields
    ? extractFieldByKeys(payloadFields, ["bps", "basis_points"])
    : payload

  return {
    kind: "percent",
    basisPoints: normalizeBigIntFromValue(bpsValue)
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
  const ruleRecord = unwrapFields(ruleField) ?? {}
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

export const formatOnChainDiscountRule = (
  discountRule: DiscountRuleOnChain
): string => {
  if (discountRule.kind === "fixed")
    return discountRule.amountCents !== undefined
      ? `${discountRule.amountCents.toString()} cents off`
      : "Fixed discount (amount unknown)"

  if (discountRule.kind === "percent") {
    if (discountRule.basisPoints === undefined)
      return "Percent discount (bps unknown)"

    const percentage = Number(discountRule.basisPoints) / 100
    return `${percentage.toFixed(2)}% off (${discountRule.basisPoints.toString()} bps)`
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
