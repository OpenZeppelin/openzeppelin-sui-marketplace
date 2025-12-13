import { SuiClient } from "@mysten/sui/client"
import path from "path"
import yargs from "yargs"

import { withTestnetFaucetRetry } from "../utils/address.ts"
import { loadDeploymentArtifacts } from "../utils/artifacts.ts"
import { getAccountConfig, type SuiNetworkConfig } from "../utils/config.ts"
import {
  DEFAULT_PUBLISH_GAS_BUDGET,
  MINIMUM_GAS_COIN_OBJECTS
} from "../utils/constants.ts"
import { loadKeypair } from "../utils/keypair.ts"
import { logKeyValueBlue, logWarning } from "../utils/log.ts"
import {
  hasDeploymentForPackage,
  resolveFullPackagePath
} from "../utils/move.ts"
import { runSuiScript } from "../utils/process.ts"
import { publishPackageWithLog } from "../utils/publish.ts"
import type { PublishArtifact } from "../utils/types.ts"

type PublishScriptArguments = {
  packagePath: string
  withUnpublishedDependencies: boolean
  dev?: boolean
  rePublish?: boolean
}

const shouldSkipPublish = (
  rePublishFlag: boolean | undefined,
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
) => !rePublishFlag && hasDeploymentForPackage(deploymentArtifacts, packagePath)

const logSkippedPublish = (networkName: string, packagePath: string) => {
  logWarning(
    "Package already published; skipping publish. Re-run with --re-publish to create a new deployment entry."
  )
  logKeyValueBlue("network")(networkName)
  logKeyValueBlue("package")(packagePath)
}

const buildFundingRequirements = (gasBudget: number) => {
  const minimumGasCoinBalance = BigInt(gasBudget) + 500_000_000n
  return {
    gasBudget,
    minimumGasCoinBalance,
    minimumBalance: minimumGasCoinBalance * 2n
  }
}

const publishPackageToNetwork = async (
  network: SuiNetworkConfig,
  packagePath: string,
  cliArguments: PublishScriptArguments
) => {
  const gasBudget = network.gasBudget ?? DEFAULT_PUBLISH_GAS_BUDGET
  const { minimumGasCoinBalance, minimumBalance } =
    buildFundingRequirements(gasBudget)

  const keypair = await loadKeypair(getAccountConfig(network))
  const suiClient = new SuiClient({ url: network.url })

  await withTestnetFaucetRetry(
    {
      signerAddress: keypair.toSuiAddress(),
      network: network.networkName,
      signer: keypair,
      minimumBalance,
      minimumCoinObjects: MINIMUM_GAS_COIN_OBJECTS,
      minimumGasCoinBalance
    },
    async () =>
      await publishPackageWithLog(
        {
          network,
          packagePath,
          fullNodeUrl: network.url,
          keypair,
          gasBudget,
          withUnpublishedDependencies: cliArguments.withUnpublishedDependencies,
          useDevBuild: Boolean(cliArguments.dev),
          useCliPublish: true
        },
        suiClient
      ),
    suiClient
  )
}

runSuiScript(
  async ({ network, paths }, cliArguments) => {
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(paths.move),
      cliArguments.packagePath
    )

    const deploymentArtifacts = await loadDeploymentArtifacts(
      network.networkName
    )

    if (
      shouldSkipPublish(
        cliArguments.rePublish,
        deploymentArtifacts,
        fullPackagePath
      )
    )
      return logSkippedPublish(network.networkName, fullPackagePath)

    await publishPackageToNetwork(network, fullPackagePath, cliArguments)
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
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description:
        "Re-publish the package even if it already exists in the deployment artifact",
      default: false
    })
    .strict()
)
