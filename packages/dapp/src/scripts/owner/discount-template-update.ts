/**
 * Updates an existing DiscountTemplate's rule, schedule, and redemption limits.
 * The template is a mutable object; changes require the ShopOwnerCap capability.
 * If you come from EVM, you are mutating a stored object rather than editing a struct in contract storage.
 * The Sui Clock shared object is included so time-based rules are enforced on chain.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  defaultStartTimestampSeconds,
  discountRuleChoices,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel,
  type NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import { SUI_CLOCK_ID } from "@sui-oracle-market/domain-core/models/pyth"
import { buildUpdateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"

type UpdateDiscountTemplateArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  discountTemplateId: string
  ruleKind: DiscountRuleKindLabel
  value: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  discountTemplateId: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const suiClient = tooling.suiClient

    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: false
    })
    const discountTemplateShared = await tooling.getSuiSharedObject({
      objectId: inputs.discountTemplateId,
      mutable: true
    })
    const sharedClockObject = await tooling.getSuiSharedObject({
      objectId: SUI_CLOCK_ID
    })

    const updateDiscountTemplateTransaction =
      buildUpdateDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplate: discountTemplateShared,
        ruleKind: inputs.ruleKind,
        ruleValue: inputs.ruleValue,
        startsAt: inputs.startsAt,
        expiresAt: inputs.expiresAt,
        maxRedemptions: inputs.maxRedemptions,
        ownerCapId: inputs.ownerCapId,
        sharedClockObject
      })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: updateDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      inputs.discountTemplateId,
      suiClient
    )

    logDiscountTemplateSummary(discountTemplateSummary)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description: "DiscountTemplate object ID to update.",
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
        "Package ID for the sui_oracle_market Move package; inferred from artifacts if omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact if available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID that authorizes updating the discount template; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: UpdateDiscountTemplateArguments,
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveLatestShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

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
    discountTemplateId: normalizeSuiObjectId(cliArguments.discountTemplateId),
    ruleKind,
    ruleValue: parseDiscountRuleValue(ruleKind, cliArguments.value),
    startsAt,
    expiresAt,
    maxRedemptions: parseOptionalU64(
      cliArguments.maxRedemptions,
      "maxRedemptions"
    )
  }
}
