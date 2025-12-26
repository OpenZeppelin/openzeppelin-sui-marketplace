import type { DiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"

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
