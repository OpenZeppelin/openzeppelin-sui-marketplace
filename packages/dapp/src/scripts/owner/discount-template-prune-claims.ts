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
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop"

type PruneDiscountClaimsArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  discountTemplateId: string
  claimers?: string[]
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  discountTemplateId: string
  claimers: string[]
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

    const pruneDiscountClaimsTransaction = buildPruneDiscountClaimsTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      discountTemplate: discountTemplateShared,
      claimers: inputs.claimers,
      ownerCapId: inputs.ownerCapId,
      sharedClockObject
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: pruneDiscountClaimsTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      inputs.discountTemplateId,
      suiClient
    )

    logDiscountTemplateSummary(discountTemplateSummary)
    logKeyValueGreen("pruned-claims")(inputs.claimers.length)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
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
        "ShopOwnerCap object ID that authorizes pruning claims; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: PruneDiscountClaimsArguments,
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
