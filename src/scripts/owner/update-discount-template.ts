import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  defaultStartTimestampSeconds,
  describeRuleKind,
  discountRuleChoices,
  formatRuleValue,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel,
  type NormalizedRuleKind
} from "../../models/discount.ts"
import { SUI_CLOCK_ID } from "../../models/pyth.ts"
import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { parseNonNegativeU64, parseOptionalU64 } from "../../utils/utility.ts"

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
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

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
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await signAndExecute(
      {
        transaction: updateDiscountTemplateTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logDiscountTemplateUpdate({
      discountTemplateId: inputs.discountTemplateId,
      ruleKind: inputs.ruleKind,
      ruleValue: inputs.ruleValue,
      startsAt: inputs.startsAt,
      expiresAt: inputs.expiresAt,
      maxRedemptions: inputs.maxRedemptions,
      digest: transactionResult.digest
    })
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
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )
  const ownerCapArtifact = await getLatestObjectFromArtifact(
    "shop::ShopOwnerCap",
    networkName
  )

  const packageId = cliArguments.shopPackageId || shopArtifact?.packageId
  if (!packageId)
    throw new Error(
      "A shop package id is required; publish the package first or provide --shop-package-id."
    )

  const shopId = cliArguments.shopId || shopArtifact?.objectId
  if (!shopId)
    throw new Error(
      "A shop id is required; create a shop first or provide --shop-id."
    )

  const ownerCapId = cliArguments.ownerCapId || ownerCapArtifact?.objectId
  if (!ownerCapId)
    throw new Error(
      "An owner cap id is required; create a shop first or provide --owner-cap-id."
    )

  const ruleKind = parseDiscountRuleKind(cliArguments.ruleKind)
  const startsAt = parseNonNegativeU64(
    cliArguments.startsAt ?? defaultStartTimestampSeconds().toString(),
    "startsAt"
  )
  const expiresAt = parseOptionalU64(cliArguments.expiresAt, "expiresAt")

  validateDiscountSchedule(startsAt, expiresAt)

  return {
    packageId: normalizeSuiObjectId(packageId),
    shopId: normalizeSuiObjectId(shopId),
    ownerCapId: normalizeSuiObjectId(ownerCapId),
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

const buildUpdateDiscountTemplateTransaction = ({
  packageId,
  shop,
  discountTemplateId,
  ruleKind,
  ruleValue,
  startsAt,
  expiresAt,
  maxRedemptions,
  ownerCapId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  discountTemplateId: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::update_discount_template`,
    arguments: [
      shopArgument,
      transaction.pure.id(discountTemplateId),
      transaction.pure.u8(ruleKind),
      transaction.pure.u64(ruleValue),
      transaction.pure.u64(startsAt),
      transaction.pure.option("u64", expiresAt ?? null),
      transaction.pure.option("u64", maxRedemptions ?? null),
      transaction.object(ownerCapId),
      transaction.object(SUI_CLOCK_ID)
    ]
  })

  return transaction
}

const logDiscountTemplateUpdate = ({
  discountTemplateId,
  ruleKind,
  ruleValue,
  startsAt,
  expiresAt,
  maxRedemptions,
  digest
}: {
  discountTemplateId: string
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  digest?: string
}) => {
  logKeyValueGreen("discount template")(discountTemplateId)
  logKeyValueGreen("rule kind")(describeRuleKind(ruleKind))
  logKeyValueGreen("rule value")(formatRuleValue(ruleKind, ruleValue))
  logKeyValueGreen("starts at")(startsAt.toString())
  if (expiresAt !== undefined)
    logKeyValueGreen("expires at")(expiresAt.toString())
  if (maxRedemptions !== undefined)
    logKeyValueGreen("max redemptions")(maxRedemptions.toString())
  if (digest) logKeyValueGreen("digest")(digest)
}
