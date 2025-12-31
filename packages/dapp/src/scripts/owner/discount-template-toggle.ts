/**
 * Enables or disables a DiscountTemplate by toggling its active flag.
 * The template is a shared object, and the update is authorized by the ShopOwnerCap capability.
 * If you come from EVM, this is like flipping a boolean in contract storage, but via object mutation.
 * The script submits a single transaction and then re-reads the updated object summary.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { buildToggleDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )
    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: false
    })
    const discountTemplateShared = await tooling.getSuiSharedObject({
      objectId: inputs.discountTemplateId,
      mutable: true
    })

    const toggleDiscountTemplateTransaction =
      buildToggleDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplate: discountTemplateShared,
        active: inputs.active,
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: toggleDiscountTemplateTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      inputs.discountTemplateId,
      tooling.suiClient
    )

    logDiscountTemplateSummary(discountTemplateSummary)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description: "DiscountTemplate object ID to toggle.",
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
        "ShopOwnerCap object ID that authorizes toggling the template; defaults to the latest artifact when omitted."
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
    active: cliArguments.active
  }
}
