/**
 * Creates a new Shop object from a published Move package.
 * On Sui, the shared Shop object acts like a contract instance, plus a separate owner capability.
 * If you come from EVM, this is closer to instantiating a contract with a factory.
 * The result is a shared Shop object plus an owner capability stored in artifacts.
 */
import yargs from "yargs"

import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"
import { resolveShopPackageId } from "@sui-oracle-market/domain-node/shop"

type CreateShopArguments = {
  name?: string
  shopPackageId?: string
}

runSuiScript(
  async (tooling, cliArguments: CreateShopArguments) => {
    const shopPackageId = await resolveShopPackageId({
      networkName: tooling.network.networkName,
      shopPackageId: cliArguments.shopPackageId
    })
    const shopName = cliArguments.name ?? "Shop"

    const createShopTransaction = buildCreateShopTransaction({
      packageId: shopPackageId,
      shopName
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
    .option("name", {
      alias: ["shop-name"],
      type: "string",
      description: "Shop name to store on-chain (defaults to Shop).",
      default: "Shop",
      demandOption: false
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from the latest publish entry in deployments/deployment.<network>.json when omitted.",
      demandOption: false
    })
    .strict()
)
