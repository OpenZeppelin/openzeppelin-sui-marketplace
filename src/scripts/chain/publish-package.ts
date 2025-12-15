import { SuiClient } from "@mysten/sui/client"
import { writeFile } from "node:fs/promises"
import path from "path"
import yargs from "yargs"

import { withTestnetFaucetRetry } from "../../tooling/address.ts"
import {
  getDeploymentArtifactPath,
  loadDeploymentArtifacts
} from "../../tooling/artifacts.ts"
import {
  getAccountConfig,
  type SuiNetworkConfig
} from "../../tooling/config.ts"
import {
  DEFAULT_PUBLISH_GAS_BUDGET,
  MINIMUM_GAS_COIN_OBJECTS
} from "../../tooling/constants.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueBlue, logWarning } from "../../tooling/log.ts"
import {
  hasDeploymentForPackage,
  resolveFullPackagePath
} from "../../tooling/move.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  claimPublisherForArtifact,
  publishPackageWithLog
} from "../../tooling/publish.ts"
import type { PublishArtifact } from "../../tooling/types.ts"

type PublishScriptArguments = {
  packagePath: string
  withUnpublishedDependencies?: boolean
  dev?: boolean
  rePublish?: boolean
  claimPublisher?: boolean
}

type ResolvedPublishOptions = {
  useDevBuild: boolean
  withUnpublishedDependencies: boolean
  allowAutoUnpublishedDependencies: boolean
  claimPublisher: boolean
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

const persistDeploymentArtifacts = async (
  networkName: string,
  artifacts: PublishArtifact[]
) => {
  const artifactPath = getDeploymentArtifactPath(networkName)
  await writeFile(artifactPath, JSON.stringify(artifacts, null, 2))
}

const findArtifactForPackage = (
  artifacts: PublishArtifact[],
  packagePath: string
) =>
  artifacts.find((artifact) =>
    (artifact.packagePath ?? "").startsWith(packagePath)
  )

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
          withUnpublishedDependencies:
            publishOptions.withUnpublishedDependencies,
          useDevBuild: publishOptions.useDevBuild,
          claimPublisher: publishOptions.claimPublisher,
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
    allowAutoUnpublishedDependencies: targetingLocalnet,
    claimPublisher: cliArguments.claimPublisher ?? true
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
    const existingArtifact = findArtifactForPackage(
      deploymentArtifacts,
      fullPackagePath
    )

    if (
      shouldSkipPublish(
        cliArguments.rePublish,
        deploymentArtifacts,
        fullPackagePath
      )
    ) {
      if (
        cliArguments.claimPublisher !== false &&
        existingArtifact &&
        !existingArtifact.publisherId
      ) {
        const keypair = await loadKeypair(getAccountConfig(network))
        const publisherId = await claimPublisherForArtifact(
          {
            artifact: existingArtifact,
            network,
            fullNodeUrl: network.url,
            keypair,
            gasBudget: network.gasBudget ?? DEFAULT_PUBLISH_GAS_BUDGET
          },
          new SuiClient({ url: network.url })
        )

        const updatedArtifacts = deploymentArtifacts.map((artifact) =>
          artifact.packageId === existingArtifact.packageId
            ? { ...artifact, publisherId }
            : artifact
        )

        await persistDeploymentArtifacts(
          network.networkName,
          updatedArtifacts
        )

        logKeyValueBlue("publisher")(publisherId)
      } else {
        logSkippedPublish(network.networkName, fullPackagePath)
      }
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
    .option("claimPublisher", {
      alias: ["claim-publisher"],
      type: "boolean",
      description:
        "Claim the 0x2::package::Publisher with the returned UpgradeCap (pass --no-claim-publisher to skip)",
      default: true
    })
    .strict()
)
