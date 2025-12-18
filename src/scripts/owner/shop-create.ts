import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { fetchShopOverview } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { logShopOverview } from "../../utils/log-summaries.ts"

runSuiScript(
  async ({ network }, { shopPackageId, publisherCapId }) => {
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)
    const packageId = normalizeSuiObjectId(shopPackageId)

    const createShopTransaction = newTransaction()
    createShopTransaction.moveCall({
      target: `${packageId}::shop::create_shop`,
      arguments: [createShopTransaction.object(publisherCapId)]
    })

    const {
      objectArtifacts: {
        created: [createdShop]
      }
    } = await signAndExecute(
      {
        transaction: createShopTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    const shopOverview = await fetchShopOverview(
      createdShop.objectId,
      suiClient
    )
    logShopOverview(shopOverview)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description: "Package ID for the sui_oracle_market Move package",
      demandOption: true
    })
    .option("publisherCapId", {
      alias: ["publisher-cap-id", "publisher-id"],
      type: "string",
      description:
        "0x2::package::Publisher object ID for this module (not the UpgradeCap). If omitted, the script will try to find one owned by the signer.",
      demandOption: true
    })
    .strict()
)
