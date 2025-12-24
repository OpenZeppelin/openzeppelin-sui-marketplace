/**
 * Creates a new DiscountTemplate object for a Shop with rule and schedule configuration.
 * In Sui, this mints a new on-chain object; ownership and mutability are explicit.
 * If you come from EVM, think "deploy a data object" rather than "append to an array in storage."
 * Authorization comes from the ShopOwnerCap, and the template can be global or listing-specific.
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
  type DiscountRuleKindLabel,
  type NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { normalizeOptionalId } from "@sui-oracle-market/tooling-core/object"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"

type CreateDiscountTemplateArguments = {
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
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  appliesToListingId?: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  publisherId?: string
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
      mutable: true
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

    const {
      objectArtifacts: { created: createdObjects }
    } = await tooling.signAndExecute({
      transaction: createDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

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
      suiClient
    )

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
        "Optional ItemListing object ID to pin this template to a single SKU."
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
        "ShopOwnerCap object ID that authorizes template creation; defaults to the latest artifact when omitted."
    })
    .option("publisherId", {
      alias: "publisher-id",
      type: "string",
      description:
        "Optional Publisher object ID for artifact metadata; resolved from existing artifacts when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: CreateDiscountTemplateArguments,
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
    appliesToListingId: normalizeOptionalId(cliArguments.listingId),
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
