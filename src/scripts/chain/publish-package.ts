import yargs from "yargs"
import { getAccountConfig } from "../utils/config.ts"
import { loadKeypair } from "../utils/keypair.ts"
import { runSuiScript } from "../utils/process.ts"
import { publishPackageWithLog } from "../utils/publish.ts"

runSuiScript(
  async ({ network, paths }, { withUnpublishedDependencies, packagePath }) => {
    const fullPackagePath = `${paths.move}/${packagePath}`.replace("//", "/")

    const accounts = getAccountConfig(network)

    const keypair = await loadKeypair(accounts)

    await publishPackageWithLog({
      network,
      packagePath: fullPackagePath,
      fullNodeUrl: network.url,
      keypair,
      gasBudget: network.gasBudget,
      withUnpublishedDependencies
    })
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
    .strict()
)
