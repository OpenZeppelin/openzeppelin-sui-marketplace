import { SuiClient } from "@mysten/sui/client"
import path from "path"
import yargs from "yargs"
import { withTestnetFaucetRetry } from "../utils/address.ts"
import { getAccountConfig } from "../utils/config.ts"
import { loadKeypair } from "../utils/keypair.ts"
import { runSuiScript } from "../utils/process.ts"
import { publishPackageWithLog } from "../utils/publish.ts"

runSuiScript(
  async (
    { network, paths },
    { withUnpublishedDependencies, packagePath, dev }
  ) => {
    const fullPackagePath = path.join(paths.move, packagePath)

    const accounts = getAccountConfig(network)

    const keypair = await loadKeypair(accounts)

    const suiClient = new SuiClient({ url: network.url })

    await withTestnetFaucetRetry(
      {
        signerAddress: keypair.toSuiAddress(),
        network: network.networkName,
        signer: keypair
      },
      async () =>
        await publishPackageWithLog(
          {
            network,
            packagePath: fullPackagePath,
            fullNodeUrl: network.url,
            keypair,
            gasBudget: network.gasBudget,
            withUnpublishedDependencies,
            useDevBuild:
              dev && network.networkName?.toLowerCase() === "localnet"
          },
          suiClient
        ),
      suiClient
    )
  },
  yargs()
    .option("packagePath", {
      alias: "package-path",
      type: "string",
      description: `The path of the package to publish in "move" directory`,
      demandOption: true
    })
    .option("withUnpublishedDependencies", {
      alias: "with-unpublished-dependencies",
      type: "boolean",
      description: `Publish package with unpublished dependencies`,
      default: false
    })
    .option("dev", {
      type: "boolean",
      description:
        "Build with dev-dependencies (use the mock Pyth package on localnet)",
      default: undefined
    })
    .strict()
)
