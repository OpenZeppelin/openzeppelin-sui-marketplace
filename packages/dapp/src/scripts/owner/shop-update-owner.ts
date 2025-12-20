import { normalizeSuiAddress } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  fetchShopOverview,
  getShopOwnerAddressFromObject
} from "@sui-oracle-market/domain-core/models/shop"
import { buildUpdateShopOwnerTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"
import { logShopOverview } from "../../utils/log-summaries.js"

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
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )
    const previousOwner = getShopOwnerAddressFromObject(shopSharedObject.object)

    const updateShopOwnerTransaction = buildUpdateShopOwnerTransaction({
      packageId: inputs.packageId,
      shop: shopSharedObject,
      ownerCapId: inputs.ownerCapId,
      newOwner: inputs.newOwner
    })

    const { transactionResult } = await signAndExecute(
      {
        transaction: updateShopOwnerTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    const updatedShopOverview = await fetchShopOverview(
      inputs.shopId,
      suiClient
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
