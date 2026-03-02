/**
 * Prunes per-claimer DiscountClaim entries from a finished template.
 * Removes `claims_by_claimer` table entries after the template is done.
 * Requires the ShopOwnerCap capability and the Clock.
 */
import yargs from "yargs"

import { SUI_CLOCK_ID } from "@sui-oracle-market/domain-core/models/pyth"
import { buildPruneDiscountClaimsTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { parseAddressList } from "@sui-oracle-market/tooling-core/address"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogDiscountTemplateMutationResult,
  executeDiscountTemplateMutation,
  fetchDiscountTemplateSummaryForMutation,
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

    const pruneDiscountClaimsTransaction = buildPruneDiscountClaimsTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      discountTemplateId: inputs.discountTemplateId,
      claimers: inputs.claimers,
      ownerCapId: inputs.ownerCapId,
      sharedClockObject
    })

    const mutationResult = await executeDiscountTemplateMutation({
      tooling,
      transaction: pruneDiscountClaimsTransaction,
      summaryLabel: "prune-discount-claims",
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
      json: cliArguments.json,
      extraJsonFields: {
        prunedClaims: inputs.claimers.length
      },
      extraLogFields: [
        {
          label: "pruned-claims",
          value: inputs.claimers.length
        }
      ]
    })
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description: "Discount template ID to prune claims from.",
      demandOption: true
    })
    .option("claimers", {
      alias: ["claimer", "claimer-address"],
      type: "array",
      string: true,
      description:
        "Claimer addresses to prune. Accepts comma-separated lists or repeat --claimer.",
      demandOption: true
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
    claimers?: string[]
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

  return {
    ...ownerTemplateMutationContext,
    claimers: parseAddressList({
      rawAddresses: cliArguments.claimers,
      label: "claimers"
    })
  }
}
