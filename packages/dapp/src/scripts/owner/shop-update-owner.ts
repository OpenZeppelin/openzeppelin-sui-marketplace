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
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"

type UpdateShopOwnerArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  newOwner: string
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

    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: true
    })
    const previousOwner = getShopOwnerAddressFromObject(shopSharedObject.object)

    const updateShopOwnerTransaction = buildUpdateShopOwnerTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      newOwner: inputs.newOwner
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: updateShopOwnerTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const updatedShopOverview = await getShopOverview(
      inputs.shopId,
      tooling.suiClient
    )
    logShopOverview(updatedShopOverview)
    logOwnerRotation({
      ownerCapId: inputs.ownerCapId,
      previousOwner,
      newOwner: inputs.newOwner,
      digest: transactionResult.digest
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
        "ShopOwnerCap object ID authorizing the rotation; defaults to the latest artifact when omitted."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: UpdateShopOwnerArguments,
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
