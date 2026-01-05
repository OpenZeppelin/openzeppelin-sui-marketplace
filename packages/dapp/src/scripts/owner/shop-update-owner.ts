/**
 * Updates the Shop's owner address (the payout recipient) using the ShopOwnerCap.
 * Ownership is stored in the Shop shared object, and the capability proves authority to mutate it.
 * If you come from EVM, this is like transferring contract ownership, but via an explicit capability object.
 * The script logs the previous and new owner and shows the updated Shop overview.
 */
import { normalizeSuiAddress } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  getShopOverview,
  getShopOwnerAddressFromObject
} from "@sui-oracle-market/domain-core/models/shop"
import { buildUpdateShopOwnerTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type UpdateShopOwnerArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  newOwner: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  newOwner: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })
    const previousOwner = getShopOwnerAddressFromObject(shopSharedObject.object)

    const updateShopOwnerTransaction = buildUpdateShopOwnerTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      newOwner: inputs.newOwner
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: updateShopOwnerTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "update-shop-owner",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    const updatedShopOverview = await getShopOverview(
      inputs.shopId,
      tooling.suiClient
    )
    if (
      emitJsonOutput(
        {
          shopOverview: updatedShopOverview,
          ownerCapId: inputs.ownerCapId,
          previousOwner,
          newOwner: inputs.newOwner,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logShopOverview(updatedShopOverview)
    logOwnerRotation({
      ownerCapId: inputs.ownerCapId,
      previousOwner,
      newOwner: inputs.newOwner,
      digest
    })
  },
  yargs()
    .option("newOwner", {
      alias: ["new-owner", "payout-address"],
      type: "string",
      description:
        "Address that should become the new shop owner and payout recipient.",
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
  cliArguments: UpdateShopOwnerArguments,
  networkName: string
): Promise<NormalizedInputs> => {
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
    newOwner: normalizeSuiAddress(cliArguments.newOwner)
  }
}

const logOwnerRotation = ({
  ownerCapId,
  previousOwner,
  newOwner,
  digest
}: {
  ownerCapId: string
  previousOwner: string
  newOwner: string
  digest?: string
}) => {
  logKeyValueGreen("owner cap")(ownerCapId)
  logKeyValueGreen("previous owner")(previousOwner)
  logKeyValueGreen("new owner")(newOwner)
  if (digest) logKeyValueGreen("digest")(digest)
}
