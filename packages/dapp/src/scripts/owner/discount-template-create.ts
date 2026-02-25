/**
 * Creates a DiscountTemplate shared object with rule + schedule.
 * Templates can be global or scoped to a listing; the Clock enforces time windows.
 * Requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  defaultStartTimestampSeconds,
  DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
  discountRuleChoices,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import { normalizeListingId } from "@sui-oracle-market/domain-core/models/item-listing"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"
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

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: createDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "create-discount-template",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const {
      objectArtifacts: { created: createdObjects }
    } = execution

    const createdDiscountTemplate = createdObjects.find((artifact) =>
      artifact.objectType.endsWith(DISCOUNT_TEMPLATE_TYPE_FRAGMENT)
    )
    if (!createdDiscountTemplate)
      throw new Error(
        "Expected a DiscountTemplate object to be created, but it was not found in transaction artifacts."
      )

    const discountTemplateId = createdDiscountTemplate.objectId

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      discountTemplateId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          discountTemplate: discountTemplateSummary,
          digest: createdDiscountTemplate.digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logDiscountTemplateSummary(discountTemplateSummary)
    if (createdDiscountTemplate.digest)
      logKeyValueGreen("digest")(createdDiscountTemplate.digest)
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
        "Optional item listing object ID to pin this template to a single SKU."
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

  const ruleKind = parseDiscountRuleKind(cliArguments.ruleKind)
  const startsAt = parseNonNegativeU64(
    cliArguments.startsAt ?? defaultStartTimestampSeconds().toString(),
    "startsAt"
  )
  const expiresAt = parseOptionalU64(cliArguments.expiresAt, "expiresAt")

  validateDiscountSchedule(startsAt, expiresAt)

  return {
    packageId,
    shopId,
    ownerCapId,
    appliesToListingId: cliArguments.listingId
      ? normalizeListingId(cliArguments.listingId, "listingId")
      : undefined,
    ruleKind,
    ruleValue: parseDiscountRuleValue(ruleKind, cliArguments.value),
    startsAt,
    expiresAt,
    maxRedemptions: parseOptionalU64(
      cliArguments.maxRedemptions,
      "maxRedemptions"
    ),
    publisherId: cliArguments.publisherId
      ? normalizeSuiObjectId(cliArguments.publisherId)
      : undefined
  }
}
