/**
 * Creates a new Shop object from a published Move package and publisher capability.
 * On Sui, publishing a package yields a Publisher object; creating a Shop uses that capability.
 * If you come from EVM, this is closer to instantiating a contract with a factory plus a capability token.
 * The result is a shared Shop object plus an owner capability stored in artifacts.
 */
import yargs from "yargs"

import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"
import { resolveShopPublishInputs } from "../../utils/published-artifacts.ts"

type CreateShopArguments = {
  shopPackageId?: string
  publisherCapId?: string
}

runSuiScript(
  async (tooling, cliArguments: CreateShopArguments) => {
    const { shopPackageId, publisherCapId } = await resolveShopPublishInputs({
      networkName: tooling.network.networkName,
      shopPackageId: cliArguments.shopPackageId,
      publisherCapId: cliArguments.publisherCapId
    })

    const createShopTransaction = buildCreateShopTransaction({
      packageId: shopPackageId,
      publisherCapId
    })

    const {
      objectArtifacts: { created: createdObjects }
    } = await tooling.signAndExecute({
      transaction: createShopTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const createdShop = createdObjects.find((artifact) =>
      artifact.objectType.endsWith("::shop::Shop")
    )
    if (!createdShop)
      throw new Error(
        "Expected a Shop object to be created, but it was not found in transaction artifacts."
      )

    const shopOverview = await getShopOverview(
      createdShop.objectId,
      tooling.suiClient
    )
    logShopOverview(shopOverview)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .option("publisherCapId", {
      alias: ["publisher-cap-id", "publisher-id"],
      type: "string",
      description:
        "0x2::package::Publisher object ID for this module (not the UpgradeCap); inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .strict()
)
