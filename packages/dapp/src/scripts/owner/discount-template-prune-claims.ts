/**
 * Prunes specific claimer addresses from a DiscountTemplate's claim tracking.
 * Templates track claims on chain to enforce redemption limits; this script removes entries.
 * If you come from EVM, this resembles deleting keys from a mapping, but the mapping is modeled as objects.
 * Uses the Sui Clock for time checks and requires the ShopOwnerCap capability.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { SUI_CLOCK_ID } from "@sui-oracle-market/domain-core/models/pyth"
import { buildPruneDiscountClaimsTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { parseAddressList } from "@sui-oracle-market/tooling-core/address"
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

    const shopSharedObject = await tooling.getImmutableSharedObject({
      objectId: inputs.shopId
    })
    const discountTemplateShared = await tooling.getMutableSharedObject({
      objectId: inputs.discountTemplateId
    })
    const sharedClockObject = await tooling.getImmutableSharedObject({
      objectId: SUI_CLOCK_ID
    })

    const pruneDiscountClaimsTransaction = buildPruneDiscountClaimsTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      discountTemplate: discountTemplateShared,
      claimers: inputs.claimers,
      ownerCapId: inputs.ownerCapId,
      sharedClockObject
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: pruneDiscountClaimsTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "prune-discount-claims",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      inputs.discountTemplateId,
      tooling.suiClient
    )

    if (
      emitJsonOutput(
        {
          discountTemplate: discountTemplateSummary,
          prunedClaims: inputs.claimers.length,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logDiscountTemplateSummary(discountTemplateSummary)
    logKeyValueGreen("pruned-claims")(inputs.claimers.length)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description: "DiscountTemplate object ID to prune claims from.",
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
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

  return {
    packageId,
    shopId,
    ownerCapId,
    discountTemplateId: normalizeSuiObjectId(cliArguments.discountTemplateId),
    claimers: parseAddressList({
      rawAddresses: cliArguments.claimers,
      label: "claimers"
    })
  }
}
