/**
 * Adds a new table-backed ItemListing entry under the Shop.
 * Uses the listing's TypeName to enforce typed receipts.
 * Requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  discountRuleChoices,
  parseDiscountRuleScheduleStringInputs,
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import { requireListingIdFromItemListingAddedEvents } from "@sui-oracle-market/domain-core/models/item-listing"
import { parseUsdToCents } from "@sui-oracle-market/domain-core/models/shop"
import { buildAddItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import { normalizeOptionalId } from "@sui-oracle-market/tooling-core/object"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogItemListingMutationResult,
  executeItemListingMutation,
  fetchItemListingSummaryForMutation,
  resolveOwnerListingCreationContext
} from "./item-listing-script-helpers.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const addItemTransaction = buildAddItemListingTransaction({
      packageId: inputs.packageId,
      itemType: inputs.itemType,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      itemName: inputs.name,
      basePriceUsdCents: inputs.priceCents,
      stock: inputs.stock,
      spotlightDiscountId: inputs.spotlightDiscountId,
      createSpotlightDiscountTemplate: inputs.createSpotlightDiscountTemplate
    })

    const mutationResult = await executeItemListingMutation({
      tooling,
      transaction: addItemTransaction,
      summaryLabel: "add-item-listing",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return

    const {
      execution: { transactionResult },
      summary
    } = mutationResult
    const listingId = requireListingIdFromItemListingAddedEvents({
      events: transactionResult.events,
      shopId: inputs.shopId
    })
    const listingSummary = await fetchItemListingSummaryForMutation({
      shopId: inputs.shopId,
      itemListingId: listingId,
      tooling
    })

    emitOrLogItemListingMutationResult({
      itemListingSummary: listingSummary,
      digest: transactionResult.digest,
      transactionSummary: summary,
      json: cliArguments.json
    })
  },
  yargs()
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
    .option("name", {
      type: "string",
      description: "Human-readable item name",
      demandOption: true
    })
    .option("price", {
      alias: ["price-cents", "usd-cents", "usd"],
      type: "string",
      description:
        "Listing price expressed in USD cents (e.g., 1250 for $12.50). Decimal input will be converted to cents.",
      demandOption: true
    })
    .option("stock", {
      type: "string",
      description: "Initial stock quantity (u64)",
      demandOption: true
    })
    .option("itemType", {
      alias: "item-type",
      type: "string",
      description:
        "Fully qualified Move type for the item (e.g., 0x...::module::ItemType)",
      demandOption: true
    })
    .option("spotlightDiscountId", {
      alias: ["spotlight-discount-id", "discount-id"],
      type: "string",
      description:
        "Optional discount template ID to spotlight for this listing (Shop::DiscountTemplate)"
    })
    .option("createSpotlightRuleKind", {
      alias: ["create-spotlight-rule-kind", "spotlight-rule-kind"],
      choices: discountRuleChoices,
      description:
        "Create and attach a new spotlight template atomically: rule kind (fixed or percent)."
    })
    .option("createSpotlightValue", {
      alias: ["create-spotlight-value", "spotlight-value"],
      type: "string",
      description:
        "Rule value for the atomically created spotlight template. fixed expects USD (e.g., 5.25), percent expects percentage (e.g., 12.5)."
    })
    .option("createSpotlightStartsAt", {
      alias: ["create-spotlight-starts-at", "spotlight-starts-at"],
      type: "string",
      description:
        "Optional start epoch seconds for the atomically created spotlight template. Defaults to now when createSpotlightRuleKind is set."
    })
    .option("createSpotlightExpiresAt", {
      alias: ["create-spotlight-expires-at", "spotlight-expires-at"],
      type: "string",
      description:
        "Optional expiry epoch seconds for the atomically created spotlight template."
    })
    .option("createSpotlightMaxRedemptions", {
      alias: ["create-spotlight-max-redemptions", "spotlight-max-redemptions"],
      type: "string",
      description:
        "Optional max redemptions for the atomically created spotlight template."
    })
    .option("publisherId", {
      alias: "publisher-id",
      type: "string",
      description:
        "Publisher object ID for artifacts; inferred from existing objects if omitted"
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    name: string
    price: string
    stock: string
    itemType: string
    spotlightDiscountId?: string
    createSpotlightRuleKind?: DiscountRuleKindLabel
    createSpotlightValue?: string
    createSpotlightStartsAt?: string
    createSpotlightExpiresAt?: string
    createSpotlightMaxRedemptions?: string
    publisherId?: string
  },
  networkName: string
) => {
  const { packageId, shopId, ownerCapId } =
    await resolveOwnerListingCreationContext({
      networkName,
      shopPackageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    })

  const spotlightDiscountId = normalizeOptionalId(
    cliArguments.spotlightDiscountId
  )
  const createSpotlightDiscountTemplate =
    normalizeCreateSpotlightTemplateInput(cliArguments)
  const itemType = cliArguments.itemType.trim()

  if (!itemType)
    throw new Error("itemType must be a fully qualified Move type.")

  return {
    packageId,
    shopId,
    ownerCapId,
    spotlightDiscountId,
    createSpotlightDiscountTemplate,
    itemType,
    name: cliArguments.name,
    priceCents: parseUsdToCents(cliArguments.price),
    stock: parsePositiveU64(cliArguments.stock, "stock"),
    publisherId: cliArguments.publisherId
      ? normalizeSuiObjectId(cliArguments.publisherId)
      : undefined
  }
}

const normalizeCreateSpotlightTemplateInput = (cliArguments: {
  spotlightDiscountId?: string
  createSpotlightRuleKind?: DiscountRuleKindLabel
  createSpotlightValue?: string
  createSpotlightStartsAt?: string
  createSpotlightExpiresAt?: string
  createSpotlightMaxRedemptions?: string
}) => {
  const hasAnyCreateTemplateInput = [
    cliArguments.createSpotlightRuleKind,
    cliArguments.createSpotlightValue,
    cliArguments.createSpotlightStartsAt,
    cliArguments.createSpotlightExpiresAt,
    cliArguments.createSpotlightMaxRedemptions
  ].some((value) => value !== undefined)

  if (!hasAnyCreateTemplateInput) return undefined

  if (normalizeOptionalId(cliArguments.spotlightDiscountId))
    throw new Error(
      "spotlightDiscountId cannot be used with createSpotlight* options."
    )

  if (!cliArguments.createSpotlightRuleKind)
    throw new Error(
      "createSpotlightRuleKind is required when using createSpotlight* options."
    )
  if (!cliArguments.createSpotlightValue)
    throw new Error(
      "createSpotlightValue is required when using createSpotlight* options."
    )

  const parsedSpotlightRuleSchedule = parseDiscountRuleScheduleStringInputs({
    ruleKind: cliArguments.createSpotlightRuleKind,
    value: cliArguments.createSpotlightValue,
    startsAt: cliArguments.createSpotlightStartsAt,
    expiresAt: cliArguments.createSpotlightExpiresAt,
    maxRedemptions: cliArguments.createSpotlightMaxRedemptions,
    startsAtLabel: "createSpotlightStartsAt",
    expiresAtLabel: "createSpotlightExpiresAt",
    maxRedemptionsLabel: "createSpotlightMaxRedemptions"
  })

  return parsedSpotlightRuleSchedule
}
