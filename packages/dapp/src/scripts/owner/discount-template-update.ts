/**
 * Updates a DiscountTemplate's rule, schedule, and caps.
 * On-chain guards block updates after claims/redemptions begin.
 * Requires the ShopOwnerCap capability and the Clock for time checks.
 */
import yargs from "yargs"

import {
  defaultStartTimestampSeconds,
  discountRuleChoices,
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import { SUI_CLOCK_ID } from "@sui-oracle-market/domain-core/models/pyth"
import { buildUpdateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogDiscountTemplateMutationResult,
  executeDiscountTemplateMutation,
  fetchDiscountTemplateSummaryForMutation,
  parseDiscountTemplateRuleScheduleInputs,
  resolveOwnerTemplateMutationContext
} from "./discount-template-script-helpers.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })
    const sharedClockObject = await tooling.getImmutableSharedObject({
      objectId: SUI_CLOCK_ID
    })

    const updateDiscountTemplateTransaction =
      buildUpdateDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplateId: inputs.discountTemplateId,
        ruleKind: inputs.ruleKind,
        ruleValue: inputs.ruleValue,
        startsAt: inputs.startsAt,
        expiresAt: inputs.expiresAt,
        maxRedemptions: inputs.maxRedemptions,
        ownerCapId: inputs.ownerCapId,
        sharedClockObject
      })

    const mutationResult = await executeDiscountTemplateMutation({
      tooling,
      transaction: updateDiscountTemplateTransaction,
      summaryLabel: "update-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return
    const discountTemplateSummary =
      await fetchDiscountTemplateSummaryForMutation({
        shopId: inputs.shopId,
        discountTemplateId: inputs.discountTemplateId,
        tooling
      })
    emitOrLogDiscountTemplateMutationResult({
      discountTemplateSummary,
      digest: mutationResult.execution.transactionResult.digest,
      transactionSummary: mutationResult.summary,
      json: cliArguments.json
    })
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description: "Discount template ID to update.",
      demandOption: true
    })
    .option("ruleKind", {
      alias: ["rule", "rule-kind"],
      choices: discountRuleChoices,
      description:
        "Discount rule type. Use fixed for USD cents off or percent for a percentage off.",
      demandOption: true
    })
    .option("value", {
      alias: ["amount", "rule-value"],
      type: "string",
      description:
        "Discount value. For fixed, provide USD (e.g., 5.25 -> $5.25). For percent, provide a percentage (e.g., 12.5 -> 12.50%).",
      demandOption: true
    })
    .option("startsAt", {
      alias: ["starts-at", "start"],
      type: "string",
      description:
        "Epoch seconds when the discount becomes active. Defaults to the current time.",
      default: defaultStartTimestampSeconds().toString()
    })
    .option("expiresAt", {
      alias: ["expires-at", "expires"],
      type: "string",
      description:
        "Optional epoch seconds when the discount expires. Must be greater than startsAt."
    })
    .option("maxRedemptions", {
      alias: ["max-redemptions", "max-uses"],
      type: "string",
      description:
        "Optional global redemption cap. Omit for unlimited redemptions."
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; defaults to the latest artifact when omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID authorizing the mutation; defaults to the latest artifact when omitted."
    })
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    discountTemplateId: string
    ruleKind: DiscountRuleKindLabel
    value: string
    startsAt?: string
    expiresAt?: string
    maxRedemptions?: string
  },
  networkName: string
) => {
  const ownerTemplateMutationContext =
    await resolveOwnerTemplateMutationContext({
      networkName,
      shopPackageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId,
      discountTemplateId: cliArguments.discountTemplateId
    })
  const parsedRuleScheduleInputs = parseDiscountTemplateRuleScheduleInputs({
    ruleKind: cliArguments.ruleKind,
    value: cliArguments.value,
    startsAt: cliArguments.startsAt,
    expiresAt: cliArguments.expiresAt,
    maxRedemptions: cliArguments.maxRedemptions
  })

  return {
    ...ownerTemplateMutationContext,
    ...parsedRuleScheduleInputs
  }
}
