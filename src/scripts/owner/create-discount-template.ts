import type { SuiObjectChangeCreated } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { parseUsdToCents } from "../../models/shop.ts"
import {
  getLatestObjectFromArtifact,
  getObjectArtifactPath,
  readArtifact,
  writeObjectArtifact
} from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import {
  extractInitialSharedVersion,
  getSuiDynamicFieldObject,
  getSuiSharedObject,
  mapOwnerToArtifact,
  normalizeOptionalId,
  normalizeVersion,
  type ObjectArtifact,
  type ObjectArtifactPackageInfo,
  type ObjectOwnerArtifact
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  assertCreatedObject,
  findCreatedObjectBySuffix,
  newTransaction,
  signAndExecute
} from "../../tooling/transactions.ts"
import { tryParseBigInt } from "../../utils/utility.ts"

type RuleKind = "fixed" | "percent"

type CreateDiscountTemplateArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  listingId?: string
  ruleKind: RuleKind
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

type NormalizedRuleKind = 0 | 1

type DiscountTemplateObjectSummary = {
  objectId: string
  objectType?: string
  owner?: ObjectOwnerArtifact
  initialSharedVersion?: string
  version?: string
  digest?: string
}

const defaultStartTimestampSeconds = () => Math.floor(Date.now() / 1000)

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

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

    const transactionResult = await signAndExecute(
      { transaction: createDiscountTemplateTransaction, signer },
      suiClient
    )

    const createdTemplate = await resolveCreatedTemplateObject({
      transactionResult,
      client: suiClient,
      shopId: inputs.shopId
    })

    const packageInfo = await resolvePackageInfo(
      inputs.packageId,
      inputs.publisherId,
      signer.toSuiAddress(),
      network.networkName
    )

    await writeObjectArtifact(getObjectArtifactPath(network.networkName), [
      buildDiscountTemplateArtifact(packageInfo, createdTemplate)
    ])

    logDiscountTemplateCreation({
      templateId: createdTemplate.objectId,
      appliesToListingId: inputs.appliesToListingId,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("ruleKind", {
      alias: ["rule", "rule-kind"],
      choices: ["fixed", "percent"] as const,
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

  const ruleKind = parseRuleKind(cliArguments.ruleKind)
  const startsAt = parseNonNegativeU64(
    cliArguments.startsAt ?? defaultStartTimestampSeconds().toString(),
    "startsAt"
  )
  const expiresAt = parseOptionalU64(cliArguments.expiresAt, "expiresAt")

  validateSchedule(startsAt, expiresAt)

  return {
    packageId: normalizeSuiObjectId(packageId),
    shopId: normalizeSuiObjectId(shopId),
    ownerCapId: normalizeSuiObjectId(ownerCapId),
    appliesToListingId: normalizeOptionalId(cliArguments.listingId),
    ruleKind,
    ruleValue: parseRuleValue(ruleKind, cliArguments.value),
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

const parseRuleKind = (ruleKind: RuleKind): NormalizedRuleKind => {
  if (ruleKind === "fixed") return 0
  if (ruleKind === "percent") return 1
  throw new Error("ruleKind must be either fixed or percent.")
}

const parseRuleValue = (
  ruleKind: NormalizedRuleKind,
  rawValue: string
): bigint =>
  ruleKind === 0
    ? parseUsdToCents(rawValue)
    : parsePercentToBasisPoints(rawValue)

const parsePercentToBasisPoints = (rawPercent: string): bigint => {
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

const parseNonNegativeU64 = (rawValue: string, label: string): bigint => {
  const value = tryParseBigInt(rawValue)
  if (value < 0n) throw new Error(`${label} cannot be negative.`)

  const maxU64 = (1n << 64n) - 1n
  if (value > maxU64)
    throw new Error(`${label} exceeds the maximum allowed u64 value.`)

  return value
}

const parseOptionalU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined =>
  rawValue === undefined ? undefined : parseNonNegativeU64(rawValue, label)

const validateSchedule = (startsAt: bigint, expiresAt?: bigint) => {
  if (expiresAt !== undefined && expiresAt <= startsAt)
    throw new Error("expiresAt must be greater than startsAt.")
}

const buildCreateDiscountTemplateTransaction = ({
  packageId,
  shop,
  appliesToListingId,
  ruleKind,
  ruleValue,
  startsAt,
  expiresAt,
  maxRedemptions,
  ownerCapId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  appliesToListingId?: string
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
    target: `${packageId}::shop::create_discount_template`,
    arguments: [
      shopArgument,
      transaction.pure.option("address", appliesToListingId ?? null),
      transaction.pure.u8(ruleKind),
      transaction.pure.u64(ruleValue),
      transaction.pure.u64(startsAt),
      transaction.pure.option("u64", expiresAt ?? null),
      transaction.pure.option("u64", maxRedemptions ?? null),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const resolveCreatedTemplateObject = async ({
  transactionResult,
  client,
  shopId
}: {
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
  client: SuiClient
  shopId: string
}): Promise<DiscountTemplateObjectSummary> => {
  const createdTemplateChange = findCreatedTemplateChange(transactionResult)
  if (createdTemplateChange) {
    return {
      objectId: createdTemplateChange.objectId,
      objectType: createdTemplateChange.objectType,
      owner: mapOwnerToArtifact(createdTemplateChange.owner),
      initialSharedVersion: extractInitialSharedVersion(createdTemplateChange),
      version: normalizeVersion(createdTemplateChange.version),
      digest: createdTemplateChange.digest
    }
  }

  const templateIdFromEvents = findTemplateIdInEvents(transactionResult)
  if (!templateIdFromEvents)
    throw new Error(
      "Transaction succeeded but DiscountTemplate was not found in object changes or events."
    )

  const { object: dynamicField } = await getSuiDynamicFieldObject(
    { childObjectId: templateIdFromEvents, parentObjectId: shopId },
    client
  )

  return {
    objectId: normalizeSuiObjectId(templateIdFromEvents),
    objectType: dynamicField.type || undefined,
    owner: mapOwnerToArtifact(dynamicField.owner || undefined),
    initialSharedVersion: extractInitialSharedVersion(dynamicField),
    version: normalizeVersion(dynamicField.version),
    digest: dynamicField.digest
  }
}

const findCreatedTemplateChange = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): SuiObjectChangeCreated | undefined => {
  const createdChange = findCreatedObjectBySuffix(
    transactionResult,
    "shop::DiscountTemplate"
  )

  return createdChange
    ? assertCreatedObject(createdChange, "shop::DiscountTemplate")
    : undefined
}

const findTemplateIdInEvents = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): string | undefined =>
  (transactionResult.events ?? []).reduce<string | undefined>(
    (found, event) => {
      if (found) return found
      const parsed = event.parsedJson as
        | {
            discount_template_id?: string
          }
        | undefined
      const matches =
        typeof event.type === "string" &&
        event.type.endsWith("::shop::DiscountTemplateCreated") &&
        typeof parsed?.discount_template_id === "string"
      return matches ? parsed.discount_template_id : undefined
    },
    undefined
  )

const resolvePackageInfo = async (
  packageId: string,
  publisherId: string | undefined,
  signer: string,
  networkName: string
): Promise<ObjectArtifactPackageInfo> => {
  const normalizedPackageId = normalizeSuiObjectId(packageId)
  const normalizedPublisherId =
    publisherId ??
    (await resolvePublisherFromArtifacts(normalizedPackageId, networkName))

  if (!normalizedPublisherId)
    throw new Error(
      "Unable to resolve publisherId. Provide --publisher-id or ensure objects artifact contains one."
    )

  return {
    packageId: normalizedPackageId,
    publisherId: normalizedPublisherId,
    signer
  }
}

const resolvePublisherFromArtifacts = async (
  packageId: string,
  networkName: string
): Promise<string | undefined> => {
  const objectArtifacts = await readArtifact<ObjectArtifact[]>(
    getObjectArtifactPath(networkName),
    []
  )

  const artifact = objectArtifacts.find(
    (existing) => existing.packageId === packageId
  )

  return artifact?.publisherId
    ? normalizeSuiObjectId(artifact.publisherId)
    : undefined
}

const buildDiscountTemplateArtifact = (
  packageInfo: ObjectArtifactPackageInfo,
  templateObject: DiscountTemplateObjectSummary
): ObjectArtifact => ({
  ...packageInfo,
  objectId: templateObject.objectId,
  objectType: templateObject.objectType || "MISSING",
  objectName: "discountTemplate",
  owner: templateObject.owner,
  initialSharedVersion: normalizeVersion(templateObject.initialSharedVersion),
  version: normalizeVersion(templateObject.version),
  digest: templateObject.digest
})

const logDiscountTemplateCreation = ({
  templateId,
  appliesToListingId,
  digest
}: {
  templateId: string
  appliesToListingId?: string
  digest?: string
}) => {
  logKeyValueGreen("discount template")(templateId)
  if (appliesToListingId)
    logKeyValueGreen("applies to listing")(appliesToListingId)
  if (digest) logKeyValueGreen("digest")(digest)
}
