import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { fetchShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"
import { logShopOverview } from "../../utils/log-summaries.js"

runSuiScript(
  async ({ network }, { shopPackageId, publisherCapId }) => {
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)
    const packageId = normalizeSuiObjectId(shopPackageId)

    const createShopTransaction = buildCreateShopTransaction({
      packageId,
      publisherCapId
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
