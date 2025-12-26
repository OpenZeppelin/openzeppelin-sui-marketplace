import type {
  DiscountRuleKindLabel,
  NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import {
  formatRuleValue,
  parseDiscountRuleKind,
  parseDiscountRuleValue
} from "@sui-oracle-market/domain-core/models/discount"
import { formatUsdFromCents } from "./format"

export const formatDiscountRulePreview = ({
  ruleKind,
  ruleValue
}: {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
}) => {
  if (ruleKind === 0) return `${formatUsdFromCents(ruleValue.toString())} off`

  return `${formatRuleValue(ruleKind, ruleValue)} off`
}

export const resolveRuleValuePreview = (
  ruleKind: DiscountRuleKindLabel,
  ruleValue: string
) => {
  if (!ruleValue.trim()) return "Enter a value"

  try {
    const normalizedKind = parseDiscountRuleKind(ruleKind)
    const normalizedValue = parseDiscountRuleValue(normalizedKind, ruleValue)
    return formatDiscountRulePreview({
      ruleKind: normalizedKind,
      ruleValue: normalizedValue
    })
  } catch {
    return "Invalid value"
  }
}
