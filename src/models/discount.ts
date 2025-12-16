import { parseUsdToCents } from "./shop.ts"

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
