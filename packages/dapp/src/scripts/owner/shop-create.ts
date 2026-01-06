/**
 * Creates a new shared Shop and mints a ShopOwnerCap for the caller.
 * This is the "instantiate contract" step after publishing the package.
 */
import yargs from "yargs"

import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { resolveShopPackageId } from "@sui-oracle-market/domain-node/shop"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logShopOverview } from "../../utils/log-summaries.ts"

type CreateShopArguments = {
  name?: string
  shopPackageId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
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

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: createShopTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "create-shop",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const {
      objectArtifacts: { created: createdObjects }
    } = execution

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
    if (
      emitJsonOutput(
        {
          shopOverview,
          digest: createdShop.digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

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
