/**
 * Enables or disables a Discount (active flag).
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import { buildToggleDiscountTransaction } from "@sui-oracle-market/domain-core/ptb/discount"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import {
  emitOrLogDiscountMutationResult,
  executeDiscountMutation,
  fetchDiscountSummaryForMutation,
  resolveOwnerTemplateMutationContext
} from "./discount-script-helpers.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const toggleDiscountTransaction = buildToggleDiscountTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      discountId: inputs.discountId,
      active: inputs.active,
      ownerCapId: inputs.ownerCapId
    })

    const mutationResult = await executeDiscountMutation({
      tooling,
      transaction: toggleDiscountTransaction,
      summaryLabel: "toggle-discount",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!mutationResult) return
    const discountSummary = await fetchDiscountSummaryForMutation({
      shopId: inputs.shopId,
      discountId: inputs.discountId,
      tooling
    })
    emitOrLogDiscountMutationResult({
      discountSummary,
      digest: mutationResult.execution.transactionResult.digest,
      transactionSummary: mutationResult.summary,
      json: cliArguments.json
    })
  },
  yargs()
    .option("discountId", {
      alias: ["discount-id"],
      type: "string",
      description: "Discount ID to toggle.",
      demandOption: true
    })
    .option("active", {
      type: "boolean",
      description:
        "Target active status. Use --active to enable or --no-active to disable the discount.",
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
    discountId: string
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
      discountId: cliArguments.discountId
    })

  return {
    ...ownerTemplateMutationContext,
    active: cliArguments.active
  }
}
