import path from "node:path"
import yargs from "yargs"

import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import { withTestnetFaucetRetry } from "@sui-oracle-market/tooling-node/address"
import { loadDeploymentArtifacts } from "@sui-oracle-market/tooling-node/artifacts"
import {
  getAccountConfig,
  type SuiNetworkConfig
} from "@sui-oracle-market/tooling-node/config"
import {
  DEFAULT_PUBLISH_GAS_BUDGET,
  MINIMUM_GAS_COIN_OBJECTS
} from "@sui-oracle-market/tooling-node/constants"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import {
  logKeyValueBlue,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import {
  hasDeploymentForPackage,
  resolveFullPackagePath
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { publishPackageWithLog } from "@sui-oracle-market/tooling-node/publish"

type PublishScriptArguments = {
  packagePath: string
  withUnpublishedDependencies?: boolean
  dev?: boolean
  rePublish?: boolean
}

type ResolvedPublishOptions = {
  useDevBuild: boolean
  withUnpublishedDependencies: boolean
  allowAutoUnpublishedDependencies: boolean
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
  publishOptions: ResolvedPublishOptions
) => {
  const gasBudget = network.gasBudget ?? DEFAULT_PUBLISH_GAS_BUDGET
  const { minimumGasCoinBalance, minimumBalance } =
    buildFundingRequirements(gasBudget)

  const keypair = await loadKeypair(getAccountConfig(network))
  const suiClient = createSuiClient(network.url)

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
      publishPackageWithLog(
        {
          network,
          packagePath,
          fullNodeUrl: network.url,
          keypair,
          gasBudget,
          withUnpublishedDependencies:
            publishOptions.withUnpublishedDependencies,
          useDevBuild: publishOptions.useDevBuild,
          useCliPublish: true,
          allowAutoUnpublishedDependencies:
            publishOptions.allowAutoUnpublishedDependencies
        },
        suiClient
      ),
    suiClient
  )
}

const derivePublishOptions = (
  networkName: string,
  cliArguments: PublishScriptArguments
): ResolvedPublishOptions => {
  const targetingLocalnet = networkName === "localnet"
  const useDevBuild = cliArguments.dev ?? targetingLocalnet

  if (useDevBuild && !targetingLocalnet)
    throw new Error(
      "Dev builds are limited to localnet. Remove --dev when publishing to shared networks."
    )

  if (!targetingLocalnet && cliArguments.withUnpublishedDependencies)
    throw new Error(
      "--with-unpublished-dependencies is reserved for localnet. Link to published packages in Move.lock for shared networks."
    )

  return {
    useDevBuild,
    withUnpublishedDependencies:
      cliArguments.withUnpublishedDependencies ?? targetingLocalnet,
    allowAutoUnpublishedDependencies: targetingLocalnet
  }
}

runSuiScript(
  async ({ network, paths }, cliArguments) => {
    // Resolve the absolute Move package path (relative to repo root or move/).
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(paths.move),
      cliArguments.packagePath
    )

    // Load prior deployment artifacts to short-circuit if already published (unless --re-publish).
    const deploymentArtifacts = await loadDeploymentArtifacts(
      network.networkName
    )

    if (
      shouldSkipPublish(
        cliArguments.rePublish,
        deploymentArtifacts,
        fullPackagePath
      )
    ) {
      logSkippedPublish(network.networkName, fullPackagePath)
      return
    }

    // Publish with network-aware options (dev builds localnet-only, published deps on shared nets).
    await publishPackageToNetwork(
      network,
      fullPackagePath,
      derivePublishOptions(network.networkName, cliArguments)
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
      default: undefined
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
