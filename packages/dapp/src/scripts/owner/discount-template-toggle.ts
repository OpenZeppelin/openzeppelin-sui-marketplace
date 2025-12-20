import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { buildToggleDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.js"

type ToggleDiscountTemplateArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  discountTemplateId: string
  active: boolean
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  discountTemplateId: string
  active: boolean
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: inputs.discountTemplateId, mutable: true },
      suiClient
    )

    const toggleDiscountTemplateTransaction =
      buildToggleDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplate: discountTemplateShared,
        active: inputs.active,
        ownerCapId: inputs.ownerCapId
      })

    const { transactionResult } = await signAndExecute(
      {
        transaction: toggleDiscountTemplateTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    const discountTemplateSummary = await getDiscountTemplateSummary(
      inputs.shopId,
      inputs.discountTemplateId,
      suiClient
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
  cliArguments: ToggleDiscountTemplateArguments,
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
    active: cliArguments.active
  }
}
