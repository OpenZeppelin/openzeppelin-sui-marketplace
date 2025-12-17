import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

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
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)
    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )

    const toggleDiscountTemplateTransaction =
      buildToggleDiscountTemplateTransaction({
        packageId: inputs.packageId,
        shop: shopSharedObject,
        discountTemplateId: inputs.discountTemplateId,
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

    logToggleResult({
      discountTemplateId: inputs.discountTemplateId,
      active: inputs.active,
      digest: transactionResult.digest
    })
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
  const { packageId, shopId, ownerCapId } = await resolveShopIdentifiers(
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

const buildToggleDiscountTemplateTransaction = ({
  packageId,
  shop,
  discountTemplateId,
  active,
  ownerCapId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  discountTemplateId: string
  active: boolean
  ownerCapId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::toggle_discount_template`,
    arguments: [
      shopArgument,
      transaction.pure.id(discountTemplateId),
      transaction.pure.bool(active),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const logToggleResult = ({
  discountTemplateId,
  active,
  digest
}: {
  discountTemplateId: string
  active: boolean
  digest?: string
}) => {
  logKeyValueGreen("discount template")(discountTemplateId)
  logKeyValueGreen("set active")(String(active))
  if (digest) logKeyValueGreen("digest")(digest)
}
