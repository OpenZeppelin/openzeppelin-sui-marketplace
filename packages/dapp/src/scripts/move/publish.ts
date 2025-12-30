/**
 * Publishes a Move package to the target network and records the deployment artifacts.
 * Sui deployment creates on-chain package objects and capabilities, so publishing is just another transaction.
 * If you come from EVM, this replaces "contract deploy" and can include unpublished dependencies in localnet.
 * The script handles faucet funding, gas budgeting, and skips publishing if already deployed.
 */
import path from "node:path"
import yargs from "yargs"

import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import {
  getLatestArtifact,
  loadDeploymentArtifacts
} from "@sui-oracle-market/tooling-node/artifacts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import {
  logKeyValueBlue,
  logWarning
} from "@sui-oracle-market/tooling-node/log"
import {
  clearPublishedEntryForNetwork,
  canonicalizePackagePath,
  hasDeploymentForPackage,
  resolveFullPackagePath
} from "@sui-oracle-market/tooling-node/move"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type PublishScriptArguments = {
  packagePath: string
  withUnpublishedDependencies?: boolean
  rePublish?: boolean
}

type ResolvedPublishOptions = {
  withUnpublishedDependencies: boolean
  allowAutoUnpublishedDependencies: boolean
}

// Publishing is a single transaction; requiring 3+ gas coin objects can force an extra
// coin-splitting transaction (and faucet calls) even when the account has enough total SUI.
const PUBLISH_MINIMUM_GAS_COIN_OBJECTS = 2

const getLatestDeploymentForPackagePath = (
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
): PublishArtifact | undefined => {
  const normalizedTargetPath = canonicalizePackagePath(packagePath)
  const matches = deploymentArtifacts.filter(
    (artifact) =>
      canonicalizePackagePath(artifact.packagePath) === normalizedTargetPath
  )
  return getLatestArtifact(matches)
}

const doesPackageObjectExistOnNetwork = async (
  tooling: Tooling,
  packageId: string
): Promise<boolean> => {
  try {
    const result = await tooling.suiClient.getObject({ id: packageId })
    return Boolean(result.data)
  } catch {
    return false
  }
}

const shouldSkipPublish = async (
  tooling: Tooling,
  rePublishFlag: boolean | undefined,
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
): Promise<boolean> => {
  if (rePublishFlag) return false
  if (!hasDeploymentForPackage(deploymentArtifacts, packagePath)) return false

  const latestDeployment = getLatestDeploymentForPackagePath(
    deploymentArtifacts,
    packagePath
  )
  const latestPackageId = latestDeployment?.packageId
  if (!latestPackageId) return false

  const existsOnChain = await doesPackageObjectExistOnNetwork(
    tooling,
    latestPackageId
  )
  if (existsOnChain) return true

  logWarning(
    "Deployment artifact exists but the package object was not found on the target network. Republish will proceed to refresh deployments."
  )
  logKeyValueBlue("artifactPackageId")(latestPackageId)
  logKeyValueBlue("network")(tooling.network.networkName)

  return false
}

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
  tooling: Tooling,
  packagePath: string,
  publishOptions: ResolvedPublishOptions
) => {
  const {
    suiConfig: { network },
    loadedEd25519KeyPair: keypair
  } = tooling
  const gasBudget = network.gasBudget ?? DEFAULT_PUBLISH_GAS_BUDGET
  const { minimumGasCoinBalance, minimumBalance } =
    buildFundingRequirements(gasBudget)

  await tooling.withTestnetFaucetRetry(
    {
      signerAddress: keypair.toSuiAddress(),
      signer: keypair,
      minimumBalance,
      minimumCoinObjects: PUBLISH_MINIMUM_GAS_COIN_OBJECTS,
      minimumGasCoinBalance
    },
    async () =>
      tooling.publishPackageWithLog({
        packagePath,
        keypair,
        gasBudget,
        withUnpublishedDependencies: publishOptions.withUnpublishedDependencies,
        useCliPublish: true,
        allowAutoUnpublishedDependencies:
          publishOptions.allowAutoUnpublishedDependencies
      })
  )
}

const derivePublishOptions = (
  networkName: string,
  cliArguments: PublishScriptArguments
): ResolvedPublishOptions => {
  const targetingLocalnet = networkName === "localnet"

  if (!targetingLocalnet && cliArguments.withUnpublishedDependencies)
    throw new Error(
      "--with-unpublished-dependencies is reserved for localnet. Link to published packages in Move.lock for shared networks."
    )

  return {
    withUnpublishedDependencies:
      cliArguments.withUnpublishedDependencies ?? targetingLocalnet,
    allowAutoUnpublishedDependencies: targetingLocalnet
  }
}

runSuiScript(
  async (tooling, cliArguments) => {
    const { network, paths } = tooling.suiConfig
    // Resolve the absolute Move package path (relative to repo root or move/).
    const fullPackagePath = resolveFullPackagePath(
      path.resolve(paths.move),
      cliArguments.packagePath
    )

    if (cliArguments.rePublish) {
      const { didUpdate } = await clearPublishedEntryForNetwork({
        packagePath: fullPackagePath,
        networkName: network.networkName
      })
      if (didUpdate) {
        logKeyValueBlue("Published.toml")(
          `cleared ${network.networkName} entry`
        )
      }
    }

    // Load prior deployment artifacts to short-circuit if already published (unless --re-publish).
    const deploymentArtifacts = await loadDeploymentArtifacts(
      network.networkName
    )

    if (
      await shouldSkipPublish(
        tooling,
        cliArguments.rePublish,
        deploymentArtifacts,
        fullPackagePath
      )
    ) {
      logSkippedPublish(network.networkName, fullPackagePath)
      return
    }

    // Publish with network-aware options (unpublished deps localnet-only, published deps on shared nets).
    await publishPackageToNetwork(
      tooling,
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
    .option("rePublish", {
      alias: "re-publish",
      type: "boolean",
      description:
        "Re-publish the package even if it already exists in the deployment artifact",
      default: false
    })
    .strict()
)
