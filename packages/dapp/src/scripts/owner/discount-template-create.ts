/**
 * Creates a DiscountTemplate entry in the Shop's template table.
 * Templates can be global or scoped to a listing; the Clock enforces time windows.
 * Requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  defaultStartTimestampSeconds,
  discountRuleChoices,
  requireDiscountTemplateIdFromCreatedEvents,
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import { normalizeListingId } from "@sui-oracle-market/domain-core/models/item-listing"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogDiscountTemplateMutationResult,
  executeDiscountTemplateMutation,
  fetchDiscountTemplateSummaryForMutation,
  parseDiscountTemplateRuleScheduleInputs
} from "./discount-template-script-helpers.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const createDiscountTemplateTransaction =
      buildCreateDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        appliesToListingId: inputs.appliesToListingId,
        ruleKind: inputs.ruleKind,
        ruleValue: inputs.ruleValue,
        startsAt: inputs.startsAt,
        expiresAt: inputs.expiresAt,
        maxRedemptions: inputs.maxRedemptions,
        ownerCapId: inputs.ownerCapId
      })

    const mutationResult = await executeDiscountTemplateMutation({
      tooling,
      transaction: createDiscountTemplateTransaction,
      summaryLabel: "create-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return
    const { execution, summary } = mutationResult

    const discountTemplateId = requireDiscountTemplateIdFromCreatedEvents({
      events: execution.transactionResult.events,
      shopId: inputs.shopId
    })
    const discountTemplateSummary =
      await fetchDiscountTemplateSummaryForMutation({
        shopId: inputs.shopId,
        discountTemplateId,
        tooling
      })

    emitOrLogDiscountTemplateMutationResult({
      discountTemplateSummary,
      digest: execution.transactionResult.digest,
      transactionSummary: summary,
      json: cliArguments.json
    })
  },
  yargs()
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
    .option("listingId", {
      alias: ["listing-id", "applies-to"],
      type: "string",
      description:
        "Optional item listing ID (u64) to pin this template to a single SKU."
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
    .option("publisherId", {
      alias: "publisher-id",
      type: "string",
      description:
        "Optional Publisher object ID for artifact metadata; resolved from existing artifacts when omitted."
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
    listingId?: string
    ruleKind: DiscountRuleKindLabel
    value: string
    startsAt?: string
    expiresAt?: string
    maxRedemptions?: string
    publisherId?: string
  },
  networkName: string
) => {
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

  const parsedRuleScheduleInputs = parseDiscountTemplateRuleScheduleInputs({
    ruleKind: cliArguments.ruleKind,
    value: cliArguments.value,
    startsAt: cliArguments.startsAt,
    expiresAt: cliArguments.expiresAt,
    maxRedemptions: cliArguments.maxRedemptions
  })

  return {
    packageId,
    shopId,
    ownerCapId,
    appliesToListingId: cliArguments.listingId
      ? normalizeListingId(cliArguments.listingId, "listingId")
      : undefined,
    ...parsedRuleScheduleInputs,
    publisherId: cliArguments.publisherId
      ? normalizeSuiObjectId(cliArguments.publisherId)
      : undefined
  }
}
