import fs from "node:fs/promises"
import path from "node:path"

import { SuiClient, type SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"
import { writeDeploymentArtifact } from "./artifacts.ts"
import type { SuiNetworkConfig } from "./config.ts"
import { getDeploymentArtifactPath } from "./constants.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "./log.ts"
import { buildMovePackage } from "./move.ts"
import { buildExplorerUrl } from "./network.ts"
import { runSuiCli } from "./suiCli.ts"
import type {
  BuildOutput,
  NetworkName,
  PublishArtifact,
  PublishedPackage,
  PublishResult
} from "./types.ts"

type PackageNames = { root?: string; dependencies: string[] }

type PublishPlan = {
  network: SuiNetworkConfig
  packagePath: string
  fullNodeUrl: string
  keypair: Ed25519Keypair
  gasBudget: number
  shouldUseUnpublishedDependencies: boolean
  unpublishedDependencies: string[]
  buildFlags: string[]
  packageNames: PackageNames
  useDevBuild?: boolean
}

export const publishPackageWithLog = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    keypair,
    gasBudget = 200_000_000,
    withUnpublishedDependencies = false,
    useDevBuild = false
  }: {
    network: SuiNetworkConfig
    packagePath: string
    fullNodeUrl: string
    keypair: Ed25519Keypair
    gasBudget?: number
    withUnpublishedDependencies?: boolean
    useDevBuild?: boolean
  },
  initiatedSuiClient?: SuiClient
): Promise<PublishArtifact[]> => {
  const publishPlan = await buildPublishPlan({
    network,
    fullNodeUrl,
    packagePath,
    keypair,
    gasBudget,
    withUnpublishedDependencies,
    useDevBuild
  })

  logPublishStart(publishPlan)

  const artifacts = await publishPackage(publishPlan, initiatedSuiClient)

  logPublishSuccess(artifacts)

  return artifacts
}

export const publishPackage = async (
  publishPlan: PublishPlan,
  initiatedSuiClient?: SuiClient
): Promise<PublishArtifact[]> => {
  const buildOutput = await buildMovePackage(
    publishPlan.packagePath,
    publishPlan.buildFlags,
    {
      // Strip test modules to keep publish transaction size under limits.
      stripTestModules: true
    }
  )

  const publishResult = await doPublishPackage(
    { ...publishPlan, buildOutput },
    initiatedSuiClient
  )

  if (!publishResult.packages.length)
    throw new Error("Publish succeeded but no packageId was returned.")

  const artifacts: PublishArtifact[] = publishResult.packages.map(
    (pkg, idx) => ({
      network: publishPlan.network.networkName,
      rpcUrl: publishPlan.fullNodeUrl,
      packagePath: pkg.isDependency
        ? `${publishPlan.packagePath}#dependency`
        : publishPlan.packagePath,
      packageName: pkg.packageName,
      packageId: pkg.packageId,
      upgradeCap: pkg.upgradeCap,
      isDependency: pkg.isDependency ?? idx > 0,
      sender: publishPlan.keypair.toSuiAddress(),
      digest: publishResult.digest,
      publishedAt: new Date().toISOString(),
      modules: pkg.isDependency ? [] : buildOutput.modules,
      dependencies: pkg.isDependency ? [] : buildOutput.dependencies,
      withUnpublishedDependencies: publishPlan.shouldUseUnpublishedDependencies,
      unpublishedDependencies: publishPlan.unpublishedDependencies,
      explorerUrl: buildExplorerUrl(
        publishResult.digest,
        publishPlan.network.networkName as NetworkName
      )
    })
  )

  await writeDeploymentArtifact(
    getDeploymentArtifactPath(publishPlan.network.networkName),
    artifacts
  )

  return artifacts
}

export const doPublishPackage = async (
  publishPlan: PublishPlan & { buildOutput: BuildOutput },
  initiatedSuiClient?: SuiClient
): Promise<PublishResult> => {
  const suiClient =
    initiatedSuiClient || new SuiClient({ url: publishPlan.fullNodeUrl })

  const publishTransaction = createPublishTransaction(
    publishPlan.buildOutput,
    publishPlan.keypair,
    publishPlan.gasBudget
  )

  const result = await suiClient.signAndExecuteTransaction({
    signer: publishPlan.keypair,
    transaction: publishTransaction,
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showEvents: true,
      showInput: true,
      showObjectChanges: true,
      showRawInput: false
    }
  })

  if (result.effects?.status.status !== "success")
    throw new Error(
      `Publish failed: ${result.effects?.status.error ?? "unknown error"}`
    )

  const publishInfo = extractPublishResult(result)
  if (!publishInfo.packages.length)
    throw new Error("Publish succeeded but no packageId was returned.")

  return labelPublishResult(publishInfo, publishPlan.packageNames)
}

/**
 * Creates a publish transaction that:
 * 1) sets sender/gas budget
 * 2) publishes the compiled modules
 * 3) transfers the upgrade cap back to the sender
 */
const createPublishTransaction = (
  buildOutput: BuildOutput,
  keypair: Ed25519Keypair,
  gasBudget: number
) => {
  const tx = new Transaction()
  const sender = keypair.getPublicKey().toSuiAddress()

  tx.setSender(sender)
  tx.setGasBudget(gasBudget)

  const [upgradeCap] = tx.publish(buildOutput)
  tx.transferObjects([upgradeCap], sender)

  return tx
}

export const runClientPublish = runSuiCli(["client", "publish"])

/**
 * Builds the full plan for a publish, including flags, dependency strategy, and package naming.
 */
const buildPublishPlan = async ({
  network,
  fullNodeUrl,
  packagePath,
  keypair,
  gasBudget,
  withUnpublishedDependencies = false,
  useDevBuild = false
}: {
  network: SuiNetworkConfig
  packagePath: string
  fullNodeUrl: string
  keypair: Ed25519Keypair
  gasBudget: number
  withUnpublishedDependencies?: boolean
  useDevBuild?: boolean
}): Promise<PublishPlan> => {
  const { unpublishedDependencies, shouldUseUnpublishedDependencies } =
    await resolveUnpublishedDependencyUsage(
      packagePath,
      withUnpublishedDependencies
    )

  if (unpublishedDependencies.length > 0 && !withUnpublishedDependencies) {
    logWarning(
      `Enabling --with-unpublished-dependencies for ${packagePath} (unpublished packages: ${unpublishedDependencies.join(
        ", "
      )})`
    )
  }

  const buildFlags = buildMoveBuildFlags({
    useDevBuild,
    includeUnpublishedDeps: shouldUseUnpublishedDependencies
  })

  return {
    network,
    packagePath,
    fullNodeUrl,
    keypair,
    gasBudget,
    useDevBuild,
    shouldUseUnpublishedDependencies,
    unpublishedDependencies,
    buildFlags,
    packageNames: await resolvePackageNames(
      packagePath,
      unpublishedDependencies
    )
  }
}

/**
 * Derives the Move build flags for publishing.
 */
const buildMoveBuildFlags = ({
  useDevBuild,
  includeUnpublishedDeps
}: {
  useDevBuild: boolean
  includeUnpublishedDeps: boolean
}) => {
  const flags = ["--dump-bytecode-as-base64", "--skip-fetch-latest-git-deps"]
  if (useDevBuild) {
    // Sui CLI 1.62 requires `--test` when compiling in dev mode so dependency
    // test helpers (e.g. std::unit_test) are available.
    flags.push("--dev", "--test")
  }
  if (includeUnpublishedDeps) flags.push("--with-unpublished-dependencies")
  return flags
}

const logPublishStart = (plan: PublishPlan) => {
  logSimpleBlue("Publishing package 💧")
  logKeyValueBlue("network")(
    `${plan.network.networkName} / ${plan.fullNodeUrl}`
  )
  logKeyValueBlue("package")(plan.packagePath)
  logKeyValueBlue("publisher")(plan.keypair.toSuiAddress())
  if (plan.useDevBuild)
    logKeyValueBlue("build mode")("dev (uses dev-dependencies)")

  if (plan.shouldUseUnpublishedDependencies) {
    logKeyValueBlue("with unpublished deps")(
      plan.unpublishedDependencies.length
        ? `enabled (${plan.unpublishedDependencies.join(", ")})`
        : "enabled"
    )
  }
}

const logPublishSuccess = (artifacts: PublishArtifact[]) => {
  logSimpleGreen("Publish succeeded ✅")
  artifacts.forEach((pkg, idx) => {
    const label = derivePackageLabel(pkg, idx)
    logKeyValueGreen("package")(label)
    logKeyValueGreen("packageId")(pkg.packageId)
    if (pkg.upgradeCap) logKeyValueGreen("upgradeCap")(pkg.upgradeCap)
  })

  if (artifacts[0]) {
    logKeyValueGreen("digest")(artifacts[0].digest)
    if (artifacts[0].explorerUrl)
      logKeyValueGreen("explorer")(artifacts[0].explorerUrl)
  }
}

const derivePackageLabel = (pkg: PublishArtifact, idx: number) =>
  pkg.packageName ?? (pkg.isDependency ? `dependency #${idx}` : "root package")

const _publishPackageWithCli = async (
  {
    packagePath,
    gasBudget,
    keystorePath
  }: {
    packagePath: string
    gasBudget: number
    keystorePath?: string
    rpcUrl: string
    signer: string
  },
  publishArguments: string[] = []
): Promise<PublishResult> => {
  if (!keystorePath) {
    throw new Error(
      "keystorePath is required when publishing with unpublished dependencies."
    )
  }

  const { stdout, stderr } = await runClientPublish([
    packagePath,
    "--json",
    "--gas-budget",
    gasBudget.toString(),
    ...publishArguments
  ])

  if (stderr?.trim()) logWarning(stderr.trim())

  const parsed = parseCliJson(stdout)

  return extractPublishResult(parsed as SuiTransactionBlockResponse)
}

const parseCliJson = (stdout: string) => {
  const lines = stdout.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const candidate = line.trim()
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue
    try {
      return JSON.parse(candidate)
    } catch {
      /* keep scanning */
    }
  }

  throw new Error("Failed to parse JSON from Sui CLI publish output.")
}

/**
 * Extracts published packages and upgrade caps from a transaction response.
 */
const extractPublishResult = (
  result: SuiTransactionBlockResponse
): PublishResult => {
  const publishedPackages =
    result.objectChanges
      ?.filter(
        (change) =>
          change.type === "published" &&
          "packageId" in change &&
          typeof change.packageId === "string"
      )
      .map((change) => (change as { packageId: string }).packageId) || []

  const upgradeCaps =
    result.objectChanges
      ?.filter(
        (change) =>
          change.type === "created" &&
          "objectType" in change &&
          typeof change.objectType === "string" &&
          change.objectType.endsWith("::package::UpgradeCap") &&
          "objectId" in change &&
          typeof change.objectId === "string"
      )
      .map((change) => (change as { objectId: string }).objectId) || []

  if (publishedPackages.length === 0) {
    return { packages: [], digest: result.digest }
  }

  const packages: PublishedPackage[] = publishedPackages.map(
    (packageId, idx) => ({
      packageId,
      upgradeCap: upgradeCaps[idx],
      isDependency: idx > 0
    })
  )

  if (upgradeCaps.length && upgradeCaps.length !== packages.length) {
    logWarning(
      `Publish returned ${packages.length} package(s) but ${upgradeCaps.length} upgrade cap(s); pairing by index.`
    )
  }

  return {
    packages,
    digest: result.digest
  }
}

const CORE_PUBLISHED_DEPENDENCIES = new Set([
  "bridge",
  "movestdlib",
  "sui",
  "suisystem"
])

/**
 * Finds dependencies that do not advertise a published address in Move.lock.
 */
const findUnpublishedDependencies = async (
  packagePath: string
): Promise<string[]> => {
  const lockPath = path.join(packagePath, "Move.lock")
  try {
    const lockContents = await fs.readFile(lockPath, "utf8")
    const packageBlocks = lockContents.split(/\[\[move\.package\]\]/).slice(1)

    const unpublishedDependencies: string[] = []
    for (const block of packageBlocks) {
      const idMatch = block.match(/id\s*=\s*"([^"]+)"/)
      if (!idMatch || CORE_PUBLISHED_DEPENDENCIES.has(idMatch[1].toLowerCase()))
        continue

      const hasPublishedAddress =
        /published-at\s*=\s*"0x[0-9a-fA-F]+"/.test(block) ||
        /published-id\s*=\s*"0x[0-9a-fA-F]+"/.test(block)

      if (!hasPublishedAddress) unpublishedDependencies.push(idMatch[1])
    }

    return unpublishedDependencies
  } catch {
    return []
  }
}

/**
 * Decides whether --with-unpublished-dependencies should be used and returns the raw dep list.
 */
const resolveUnpublishedDependencyUsage = async (
  packagePath: string,
  explicitWithUnpublished?: boolean
) => {
  const unpublishedDependencies = await findUnpublishedDependencies(packagePath)
  const shouldUseUnpublishedDependencies =
    explicitWithUnpublished || unpublishedDependencies.length > 0

  return { unpublishedDependencies, shouldUseUnpublishedDependencies }
}

/**
 * Adds human-friendly names to the publish result, pairing upgrade caps with package names.
 */
const labelPublishResult = (
  publishResult: PublishResult,
  packageNames?: { root?: string; dependencies: string[] }
): PublishResult => {
  if (!publishResult.packages.length) return publishResult

  const labeledPackages = publishResult.packages.map((pkg, idx) => {
    const isDependency = pkg.isDependency ?? idx > 0
    const packageName = isDependency
      ? packageNames?.dependencies?.[idx - 1]
      : packageNames?.root

    return {
      ...pkg,
      isDependency,
      packageName
    }
  })

  return { ...publishResult, packages: labeledPackages }
}

/**
 * Reads Move.toml to extract the root package name and decorates dependency names from the lock.
 */
const resolvePackageNames = async (
  packagePath: string,
  unpublishedDependencies: string[]
): Promise<{ root?: string; dependencies: string[] }> => {
  const moveTomlPath = path.join(packagePath, "Move.toml")

  let root: string | undefined
  try {
    const moveToml = await fs.readFile(moveTomlPath, "utf8")
    const match = moveToml.match(/name\s*=\s*"([^"]+)"/)
    root = match?.[1]
  } catch {
    /* ignore */
  }

  return { root, dependencies: unpublishedDependencies }
}
