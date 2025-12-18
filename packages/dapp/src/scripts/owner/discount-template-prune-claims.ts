import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { getDiscountTemplateSummary } from "../../models/discount.ts"
import { SUI_CLOCK_ID } from "../../models/pyth.ts"
import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { parseAddressList } from "../../tooling/address.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"

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
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: inputs.discountTemplateId, mutable: true },
      suiClient
    )
    const sharedClockObject = await getSuiSharedObject(
      { objectId: SUI_CLOCK_ID },
      suiClient
    )

    const pruneDiscountClaimsTransaction =
      buildPruneDiscountClaimsTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplate: discountTemplateShared,
        claimers: inputs.claimers,
        ownerCapId: inputs.ownerCapId,
        sharedClockObject
      })

    const { transactionResult } = await signAndExecute(
      {
        transaction: pruneDiscountClaimsTransaction,
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
    claimers: parseAddressList(cliArguments.claimers, "claimers")
  }
}

const buildPruneDiscountClaimsTransaction = ({
  packageId,
  shop,
  discountTemplate,
  claimers,
  ownerCapId,
  sharedClockObject
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  discountTemplate: Awaited<ReturnType<typeof getSuiSharedObject>>
  claimers: string[]
  ownerCapId: string
  sharedClockObject: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const discountTemplateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::prune_discount_claims`,
    arguments: [
      shopArgument,
      discountTemplateArgument,
      transaction.pure.vector("address", claimers),
      transaction.object(ownerCapId),
      clockArgument
    ]
  })

  return transaction
}
