/**
 * Enables or disables a DiscountTemplate (active flag).
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import { buildToggleDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
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

    const toggleDiscountTemplateTransaction =
      buildToggleDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplateId: inputs.discountTemplateId,
        active: inputs.active,
        ownerCapId: inputs.ownerCapId
      })

    const mutationResult = await executeDiscountTemplateMutation({
      tooling,
      transaction: toggleDiscountTemplateTransaction,
      summaryLabel: "toggle-discount-template",
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
      description: "Discount template ID to toggle.",
      demandOption: true
    })
    .option("active", {
      type: "boolean",
      description:
        "Target active status. Use --active to enable or --no-active to disable the template.",
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
    active: boolean
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
    active: cliArguments.active
  }
}
