import fs from "node:fs/promises"
import path from "node:path"

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { buildExplorerUrl } from "@sui-oracle-market/tooling-core/network"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type {
  BuildOutput,
  NetworkName,
  PublishArtifact,
  PublishedPackage,
  PublishResult
} from "@sui-oracle-market/tooling-core/types"

import {
  getDeploymentArtifactPath,
  pickRootNonDependencyArtifact,
  writeDeploymentArtifact
} from "./artifacts.ts"
import type { SuiNetworkConfig } from "./config.ts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "./constants.ts"
import type { Tooling, ToolingContext } from "./factory.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "./log.ts"
import {
  extractSingleSuiFrameworkRevisionFromMoveLock,
  extractSuiFrameworkPinnedEntriesFromMoveLock,
  extractSuiFrameworkRevisionsFromMoveLock
} from "./move-lock.ts"
import {
  buildMoveEnvironmentFlags,
  buildMovePackage,
  clearPublishedEntryForNetwork,
  syncLocalnetMoveEnvironmentChainId
} from "./move.ts"
import { runSuiCli } from "./suiCli.ts"

type PackageNames = { root?: string; dependencies: string[] }
type DependencyAddressMap = Record<string, string>

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
  useCliPublish?: boolean
  keystorePath?: string
  suiCliVersion?: string
  allowAutoUnpublishedDependencies?: boolean
}

const syncLocalnetMoveEnvironmentChainIdForPublish = async ({
  network,
  packagePath,
  suiClient
}: {
  network: SuiNetworkConfig
  packagePath: string
  suiClient: SuiClient
}) => {
  const { chainId, updatedFiles, didAttempt } =
    await syncLocalnetMoveEnvironmentChainId({
      moveRootPath: packagePath,
      environmentName: network.networkName,
      suiClient
    })

  if (didAttempt && !chainId) {
    logWarning(
      "Unable to resolve localnet chain id; Move.toml environments were not updated."
    )
  }

  if (updatedFiles.length) {
    logKeyValueBlue("Move.toml")(
      `updated ${updatedFiles.length} localnet environment entries`
    )
  }
}

/**
 * Builds and publishes a Move package, logging friendly output and persisting artifacts.
 * Publishing on Sui bundles compiled modules, dependency addresses, and gas strategy, so this
 * helper provides deploy-script ergonomics while honoring Sui-specific constraints
 * (unpublished deps, Move.toml environments/dep-replacements, UpgradeCap transfer).
 *
 * Note: For Sui 1.63+ the package manager expects published dependency addresses
 * to be managed via Move.toml environments/dep-replacements or Move registry (mvr),
 * not by mutating Move.lock.
 */
export const publishPackageWithLog = async (
  {
    packagePath,
    keypair,
    gasBudget = DEFAULT_PUBLISH_GAS_BUDGET,
    withUnpublishedDependencies = false,
    useCliPublish = true,
    allowAutoUnpublishedDependencies = true
  }: {
    packagePath: string
    keypair: Ed25519Keypair
    gasBudget?: number
    withUnpublishedDependencies?: boolean
    useCliPublish?: boolean
    allowAutoUnpublishedDependencies?: boolean
  },
  suiContext: ToolingContext
): Promise<PublishArtifact[]> => {
  const resolvedFullNodeUrl = suiContext.suiConfig.network.url

  if (!resolvedFullNodeUrl)
    throw new Error("Missing network.url in ToolingContext.network.")

  const publishPlan = await buildPublishPlan({
    network: suiContext.suiConfig.network,
    fullNodeUrl: resolvedFullNodeUrl,
    packagePath,
    keypair,
    suiClient: suiContext.suiClient,
    gasBudget,
    withUnpublishedDependencies,
    useCliPublish,
    allowAutoUnpublishedDependencies
  })

  logPublishStart(publishPlan)

  const artifacts = await publishPackage(publishPlan, suiContext)

  logPublishSuccess(artifacts)

  return artifacts
}
/**
 * Publishes a Move package according to a prepared plan (build flags, dep strategy).
 * Returns publish artifacts persisted to disk (package ID, UpgradeCap, Publisher, deps).
 *
 * Note: For Sui 1.63+ the dependency linkage for shared networks is controlled by
 * Move.toml environment config (dep-replacements) or Move registry (mvr).
 */
export const publishPackage = async (
  publishPlan: PublishPlan,
  suiContext: ToolingContext
): Promise<PublishArtifact[]> => {
  const shouldStripTestModules = !publishPlan.shouldUseUnpublishedDependencies
  const buildOutput = await buildMovePackage(
    publishPlan.packagePath,
    publishPlan.buildFlags,
    {
      stripTestModules: shouldStripTestModules
    }
  )

  let publishResult: PublishResult
  try {
    publishResult = publishPlan.useCliPublish
      ? await publishViaCli(publishPlan)
      : await doPublishPackage(publishPlan, buildOutput, suiContext)
  } catch (error) {
    if (shouldRetryWithCli(publishPlan, error)) {
      logWarning(
        "SDK publish exceeded transaction limits; retrying with Sui CLI publish (handles unpublished dependencies natively)."
      )
      publishResult = await publishViaCli({
        ...publishPlan,
        useCliPublish: true
      })
    } else {
      throw error
    }
  }

  if (!publishResult.packages.length)
    throw new Error("Publish succeeded but no packageId was returned.")

  const dependencyAddresses: DependencyAddressMap =
    buildOutput.dependencyAddresses ?? {}

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
      publisherId: pkg.publisherId,
      isDependency: pkg.isDependency ?? idx > 0,
      sender: publishPlan.keypair.toSuiAddress(),
      digest: publishResult.digest,
      publishedAt: new Date().toISOString(),
      modules: pkg.isDependency ? [] : buildOutput.modules,
      dependencies: pkg.isDependency ? [] : buildOutput.dependencies,
      dependencyAddresses,
      withUnpublishedDependencies: publishPlan.shouldUseUnpublishedDependencies,
      unpublishedDependencies: publishPlan.unpublishedDependencies,
      suiCliVersion: publishPlan.suiCliVersion,
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

/**
 * Executes a publish transaction via the SDK and returns parsed publish results.
 */
export const doPublishPackage = async (
  publishPlan: PublishPlan,
  buildOutput: BuildOutput,
  { suiClient }: ToolingContext
): Promise<PublishResult> => {
  const publishTransaction = createPublishTransaction(
    buildOutput,
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
 * Builds the publish transaction with a publish command and upgrade cap transfer.
 */
const createPublishTransaction = (
  buildOutput: BuildOutput,
  keypair: Ed25519Keypair,
  gasBudget: number
) => {
  const tx = newTransaction(gasBudget)
  const sender = keypair.getPublicKey().toSuiAddress()

  tx.setSender(sender)

  const [upgradeCap] = tx.publish(buildOutput)
  tx.transferObjects([upgradeCap], sender)

  return tx
}

/**
 * CLI runner for `sui client publish`.
 */
export const runClientPublish = runSuiCli(["client", "publish"])
/**
 * CLI runner for `sui --version`.
 */
const runSuiCliVersion = runSuiCli([])

/**
 * Builds the full plan for a publish, including flags, dependency strategy, and package naming.
 */
const buildPublishPlan = async ({
  network,
  fullNodeUrl,
  packagePath,
  keypair,
  suiClient,
  gasBudget,
  withUnpublishedDependencies = false,
  useCliPublish = true,
  allowAutoUnpublishedDependencies = true
}: {
  network: SuiNetworkConfig
  packagePath: string
  fullNodeUrl: string
  keypair: Ed25519Keypair
  suiClient: SuiClient
  gasBudget: number
  withUnpublishedDependencies?: boolean
  useCliPublish?: boolean
  allowAutoUnpublishedDependencies?: boolean
}): Promise<PublishPlan> => {
  if (network.networkName !== "localnet" && withUnpublishedDependencies)
    throw new Error(
      "--with-unpublished-dependencies is reserved for localnet. For shared networks, link to published packages via Move.toml dep-replacements (or Move registry/mvr)."
    )

  await syncLocalnetMoveEnvironmentChainIdForPublish({
    network,
    packagePath,
    suiClient
  })

  const allowImplicitUnpublishedDependencies =
    network.networkName === "localnet"
      ? allowAutoUnpublishedDependencies
      : false

  const shouldUseUnpublishedDependencies = Boolean(
    network.networkName === "localnet"
      ? withUnpublishedDependencies || allowImplicitUnpublishedDependencies
      : withUnpublishedDependencies
  )

  const unpublishedDependencies: string[] = []

  // Localnet publishes are intentionally permissive, but a mixed Sui framework in Move.lock
  // is a strong signal that shared-network publishes will fail later.
  if (network.networkName === "localnet") {
    await warnOnFrameworkRevisionInconsistency(packagePath)
  }

  if (
    !shouldSkipFrameworkConsistency(
      network.networkName,
      allowImplicitUnpublishedDependencies
    )
  ) {
    await assertFrameworkRevisionConsistency(packagePath)
  }

  const implicitlyEnabledUnpublishedDeps =
    network.networkName === "localnet" &&
    allowImplicitUnpublishedDependencies &&
    !withUnpublishedDependencies &&
    shouldUseUnpublishedDependencies

  if (implicitlyEnabledUnpublishedDeps) {
    logWarning(
      `Enabling --with-unpublished-dependencies for ${packagePath} (localnet auto mode).`
    )
  }

  const buildFlags = buildMoveBuildFlags({
    environmentName: network.networkName,
    includeUnpublishedDeps: Boolean(shouldUseUnpublishedDependencies)
  })

  const cliPublish = useCliPublish

  return {
    network,
    packagePath,
    fullNodeUrl,
    keypair,
    gasBudget,
    shouldUseUnpublishedDependencies: Boolean(shouldUseUnpublishedDependencies),
    unpublishedDependencies,
    buildFlags,
    useCliPublish: cliPublish,
    keystorePath: network.account?.keystorePath,
    suiCliVersion: await getSuiCliVersion(),
    packageNames: await resolvePackageNames(
      packagePath,
      unpublishedDependencies
    ),
    allowAutoUnpublishedDependencies: allowImplicitUnpublishedDependencies
  }
}

const DUMP_BYTECODE_AS_BASE64_FLAG = "--dump-bytecode-as-base64"
/**
 * Determines whether to skip framework revision checks for the given network/build mode.
 */
const shouldSkipFrameworkConsistency = (
  networkName: string,
  allowAutoUnpublishedDependencies: boolean
) => networkName === "localnet" || allowAutoUnpublishedDependencies

/**
 * Derives the Move build flags for publishing with environment-aware settings.
 */
const buildMoveBuildFlags = ({
  environmentName,
  includeUnpublishedDeps
}: {
  environmentName: string
  includeUnpublishedDeps: boolean
}) => {
  const flags = [
    DUMP_BYTECODE_AS_BASE64_FLAG,
    ...buildMoveEnvironmentFlags({ environmentName })
  ]
  if (includeUnpublishedDeps) flags.push("--with-unpublished-dependencies")

  return flags
}

/** Logs publish plan details before execution. */
const logPublishStart = (plan: PublishPlan) => {
  logSimpleBlue("\nPublishing package 💧")
  logKeyValueBlue("network")(
    `${plan.network.networkName} / ${plan.fullNodeUrl}`
  )
  logKeyValueBlue("package")(plan.packagePath)
  logKeyValueBlue("publisher")(plan.keypair.toSuiAddress())
  logKeyValueBlue("gas budget")(plan.gasBudget)
  logKeyValueBlue("mode")(plan.useCliPublish ? "cli" : "sdk")

  if (plan.shouldUseUnpublishedDependencies) {
    logKeyValueBlue("with unpublished deps")(
      plan.unpublishedDependencies.length
        ? `enabled (${plan.unpublishedDependencies.join(", ")})`
        : "enabled"
    )
  }
}

/** Logs successful publish output for all artifacts. */
const logPublishSuccess = (artifacts: PublishArtifact[]) => {
  logSimpleGreen("Publish succeeded ✅\n")
  artifacts.forEach((artifact, idx) => {
    const label = derivePackageLabel(artifact, idx)
    logKeyValueGreen("package")(label)
    logKeyValueGreen("packageId")(artifact.packageId)
    if (artifact.upgradeCap) logKeyValueGreen("upgradeCap")(artifact.upgradeCap)
    if (artifact.publisherId)
      logKeyValueGreen("publisher")(artifact.publisherId)
  })

  if (artifacts[0]) {
    logKeyValueGreen("digest")(artifacts[0].digest)
    if (artifacts[0].explorerUrl)
      logKeyValueGreen("explorer")(artifacts[0].explorerUrl)
  }
}

/**
 * Derives a human-friendly label for a published package entry.
 */
const derivePackageLabel = (artifact: PublishArtifact, idx: number) =>
  artifact.packageName ??
  (artifact.isDependency ? `dependency #${idx}` : "root package")

/**
 * Builds CLI arguments for `sui client publish`.
 */
const buildCliPublishArguments = (plan: PublishPlan): string[] => {
  const args = [
    plan.packagePath,
    "--json",
    "--gas-budget",
    plan.gasBudget.toString(),
    "--sender",
    plan.keypair.toSuiAddress(),
    ...buildMoveEnvironmentFlags({
      environmentName: plan.network.networkName
    })
  ]

  if (plan.shouldUseUnpublishedDependencies)
    args.push("--with-unpublished-dependencies")

  return args
}

/**
 * Publishes using `sui client publish` to mirror CLI behavior.
 */
const publishViaCli = async (plan: PublishPlan): Promise<PublishResult> => {
  const args = buildCliPublishArguments(plan)

  warnIfCliMissingKeystore(plan)

  const cliEnv =
    plan.keystorePath !== undefined
      ? { ...process.env, SUI_KEYSTORE_PATH: plan.keystorePath }
      : undefined

  const { stdout, stderr, exitCode } = await runClientPublish(args, {
    env: cliEnv
  })
  if (stderr?.toString().trim()) logWarning(stderr.toString().trim())

  if (exitCode && exitCode !== 0) {
    const outputTail = [stdout, stderr]
      .filter(Boolean)
      .map((chunk) => chunk.toString().trim())
      .filter(Boolean)
      .join("\n")
    throw new Error(
      `Sui CLI publish exited with code ${exitCode}${
        outputTail ? `:\n${outputTail}` : ""
      }`
    )
  }

  const parsed = parseCliJson(stdout.toString())
  const publishResult = extractPublishResult(
    parsed as SuiTransactionBlockResponse
  )

  return labelPublishResult(publishResult, plan.packageNames)
}

/** Warns when CLI publish may need a keystore path but none was provided. */
const warnIfCliMissingKeystore = (plan: PublishPlan) => {
  if (!plan.shouldUseUnpublishedDependencies) return
  if (plan.keystorePath) return

  logWarning(
    "Publishing with unpublished dependencies via CLI but no keystore path override was provided; relying on the default Sui CLI keystore (set SUI_KEYSTORE_PATH to override)."
  )
}

/** Finds the last JSON-looking line in CLI stdout and parses it. */
const parseCliJson = (stdout: string) => {
  const trimmed = stdout.trim()
  if (!trimmed)
    throw new Error("Failed to parse JSON from Sui CLI publish output.")

  const tryParse = (candidate: string) => {
    try {
      return JSON.parse(candidate)
    } catch {
      return undefined
    }
  }

  const direct = tryParse(trimmed)
  if (direct) return direct

  const lines = trimmed.split(/\r?\n/)
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx]?.trimStart()
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) continue

    const candidate = lines.slice(idx).join("\n").trim()
    const parsed = tryParse(candidate)
    if (parsed) return parsed
  }

  const trailingBlockMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])\s*$/)
  const trailingJson = trailingBlockMatch?.[1]?.trim()
  if (trailingJson) {
    const parsed = tryParse(trailingJson)
    if (parsed) return parsed
  }

  const tail = lines.slice(-20).join("\n")
  throw new Error(
    `Failed to parse JSON from Sui CLI publish output. stdout tail:\n${tail}`
  )
}

/**
 * Extracts published packages and upgrade caps from a transaction response.
 */
const extractPublishResult = (
  result: SuiTransactionBlockResponse
): PublishResult => {
  const collectCreatedObjectIds = (
    predicate: (objectType: string) => boolean
  ): string[] =>
    result.objectChanges
      ?.filter(
        (change) =>
          change.type === "created" &&
          "objectType" in change &&
          typeof change.objectType === "string" &&
          predicate(change.objectType as string) &&
          "objectId" in change &&
          typeof change.objectId === "string"
      )
      .map((change) => (change as { objectId: string }).objectId) || []

  const warnOnCountMismatch = (
    label: string,
    actual: number,
    expected: number
  ) => {
    if (actual === 0 || actual === expected) return
    logWarning(
      `Publish returned ${expected} package(s) but ${actual} ${label}(s); pairing by index.`
    )
  }

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

  const publisherIds = collectCreatedObjectIds((objectType) =>
    objectType.endsWith("::package::Publisher")
  )

  if (publishedPackages.length === 0) {
    return { packages: [], digest: result.digest }
  }

  const packages: PublishedPackage[] = publishedPackages.map(
    (packageId, idx) => ({
      packageId,
      upgradeCap: upgradeCaps[idx],
      publisherId: publisherIds[idx],
      isDependency: idx > 0
    })
  )

  warnOnCountMismatch("upgrade cap", upgradeCaps.length, packages.length)
  warnOnCountMismatch("publisher object", publisherIds.length, packages.length)

  return {
    packages,
    digest: result.digest
  }
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

/** Ensures the root package and any local dependencies share the same framework git revision. */
const assertFrameworkRevisionConsistency = async (packagePath: string) => {
  const frameworkRevisions = await readFrameworkRevisionsForPackage(packagePath)
  if (frameworkRevisions.size === 0) return

  if (frameworkRevisions.size > 1)
    throw new Error(
      await buildMultipleFrameworkRevisionsMessage({
        packagePath,
        frameworkRevisions,
        severity: "error"
      })
    )

  const [rootFrameworkRevision] = [...frameworkRevisions]

  const dependencyPackages = await discoverLocalDependencyPackages(packagePath)
  const mismatchedRevisions = collectMismatchedFrameworkRevisions(
    rootFrameworkRevision,
    dependencyPackages
  )

  if (mismatchedRevisions.length) {
    throw new Error(buildFrameworkMismatchMessage(mismatchedRevisions))
  }
}

const warnOnFrameworkRevisionInconsistency = async (packagePath: string) => {
  const frameworkRevisions = await readFrameworkRevisionsForPackage(packagePath)
  if (frameworkRevisions.size <= 1) return

  logWarning(
    await buildMultipleFrameworkRevisionsMessage({
      packagePath,
      frameworkRevisions,
      severity: "warning"
    })
  )
}

const groupPinnedEntriesByRevision = <TEntry extends { revision: string }>(
  entries: TEntry[]
): Map<string, TEntry[]> => {
  const grouped = new Map<string, TEntry[]>()

  for (const entry of entries) {
    const existing = grouped.get(entry.revision) ?? []
    grouped.set(entry.revision, [...existing, entry])
  }

  return grouped
}

const buildMultipleFrameworkRevisionsMessage = async ({
  packagePath,
  frameworkRevisions,
  severity
}: {
  packagePath: string
  frameworkRevisions: Set<string>
  severity: "warning" | "error"
}) => {
  const lockPath = path.join(packagePath, "Move.lock")

  let lockContents: string | undefined
  try {
    lockContents = await fs.readFile(lockPath, "utf8")
  } catch {
    lockContents = undefined
  }

  const pinnedEntries = lockContents
    ? extractSuiFrameworkPinnedEntriesFromMoveLock({
        lockContents,
        environmentName: undefined
      })
    : []

  const groupedEntries = groupPinnedEntriesByRevision(pinnedEntries)

  const isFrameworkPackageName = (packageName: string) =>
    packageName === "Sui" ||
    packageName.startsWith("Sui_") ||
    packageName === "MoveStdlib" ||
    packageName.startsWith("MoveStdlib_")

  const getNonFrameworkPackagesForRevision = (revision: string) => {
    const entriesForRevision = groupedEntries.get(revision) ?? []
    return [
      ...new Set(
        entriesForRevision
          .map((entry) => entry.packageName)
          .filter((packageName) => !isFrameworkPackageName(packageName))
      )
    ].sort()
  }

  const detailsLines: string[] = []
  if (pinnedEntries.length) {
    detailsLines.push("Details (from Move.lock pinned sections):")
    for (const revision of [...frameworkRevisions]) {
      const entriesForRevision = groupedEntries.get(revision) ?? []
      const formattedEntries = entriesForRevision
        .map((entry) => {
          const environmentLabel = entry.environmentName
            ? `${entry.environmentName}.`
            : ""

          const subdirLabel = entry.subdir ? ` (${entry.subdir})` : ""
          return `  - ${environmentLabel}${entry.packageName}${subdirLabel}`
        })
        .sort()

      detailsLines.push(`- ${revision}`)
      detailsLines.push(
        ...(formattedEntries.length
          ? formattedEntries
          : ["  - (no pinned section details available)"])
      )
    }
  }

  const howToFixLines: string[] = []
  if (pinnedEntries.length) {
    const revisions = [...frameworkRevisions]

    const revisionNonFrameworkCounts = revisions
      .map((revision) => ({
        revision,
        nonFrameworkPackages: getNonFrameworkPackagesForRevision(revision)
      }))
      .sort(
        (a, b) => a.nonFrameworkPackages.length - b.nonFrameworkPackages.length
      )

    const outlier = revisionNonFrameworkCounts[0]
    const outlierLabel =
      outlier && outlier.nonFrameworkPackages.length
        ? `Likely outlier revision: ${outlier.revision} (introduced by ${outlier.nonFrameworkPackages.join(
            ", "
          )}).`
        : undefined

    howToFixLines.push("How to fix:")
    if (outlierLabel) howToFixLines.push(`- ${outlierLabel}`)

    for (const {
      revision,
      nonFrameworkPackages
    } of revisionNonFrameworkCounts) {
      if (!nonFrameworkPackages.length) continue
      howToFixLines.push(
        `- Dependencies pinned under ${revision}: ${nonFrameworkPackages.join(", ")}`
      )
    }

    howToFixLines.push(
      "- Pick ONE revision to keep, then bump/downgrade the dependencies listed under the other revision(s) until Move.lock contains only a single Sui/MoveStdlib per environment."
    )
    howToFixLines.push(
      "- Regenerate Move.lock after changes (for example via `sui move update-deps` or a fresh `sui move build`)."
    )
  }

  const title =
    severity === "warning"
      ? "Multiple Sui framework revisions detected in Move.lock (warning)."
      : "Multiple Sui framework revisions detected in Move.lock."

  return [
    title,
    `Root package: ${packagePath}`,
    `Revisions: ${[...frameworkRevisions].join(", ")}`,
    ...(detailsLines.length ? ["", ...detailsLines] : []),
    ...(howToFixLines.length ? ["", ...howToFixLines] : []),
    "",
    "Align all dependencies to a single Sui framework revision (typically by updating your Move dependencies together and regenerating Move.lock) before publishing to shared networks."
  ].join("\n")
}

/**
 * Collects mismatched framework revision messages across dependencies.
 */
const collectMismatchedFrameworkRevisions = (
  rootFrameworkRevision: string,
  dependencyPackages: Array<{
    name: string
    path: string
    frameworkRevision?: string
  }>
) =>
  dependencyPackages
    .map((dependencyPackage) => {
      const dependencyFrameworkRevision = dependencyPackage.frameworkRevision
      if (
        dependencyFrameworkRevision &&
        dependencyFrameworkRevision !== rootFrameworkRevision
      ) {
        return `${dependencyPackage.name} (${dependencyPackage.path}) uses rev ${dependencyFrameworkRevision}, root uses ${rootFrameworkRevision}`
      }
      return undefined
    })
    .filter(Boolean) as string[]

/**
 * Builds a human-readable error when framework revisions differ.
 */
const buildFrameworkMismatchMessage = (mismatches: string[]) =>
  [
    "Framework version mismatch detected across Move.lock files.",
    ...mismatches.map((mismatch) => `- ${mismatch}`),
    "Align all packages to the same Sui framework commit (for example via `sui move update-deps`) before publishing."
  ].join("\n")

/**
 * Reads the Sui framework revision for a package from Move.lock.
 */
const readFrameworkRevisionsForPackage = async (
  packagePath: string
): Promise<Set<string>> => {
  const lockPath = path.join(packagePath, "Move.lock")
  try {
    const lockContents = await fs.readFile(lockPath, "utf8")
    return extractSuiFrameworkRevisionsFromMoveLock({
      lockContents,
      environmentName: undefined
    })
  } catch {
    return new Set<string>()
  }
}

/**
 * Finds local Move package dependencies defined via `local = "..."`
 */
const discoverLocalDependencyPackages = async (
  packagePath: string
): Promise<
  Array<{ name: string; path: string; frameworkRevision?: string }>
> => {
  const moveTomlPath = path.join(packagePath, "Move.toml")
  try {
    const moveTomlContents = await fs.readFile(moveTomlPath, "utf8")
    const dependencyMatches = [
      ...moveTomlContents.matchAll(
        /\[(?:dev-dependencies|dependencies)\.([^\]]+)\][\s\S]*?local\s*=\s*"([^"]+)"/g
      )
    ]

    const localDependencyPaths = new Map<
      string,
      { name: string; path: string }
    >()
    for (const match of dependencyMatches) {
      const dependencyName = match[1]
      const relativeDependencyPath = match[2]
      const absoluteDependencyPath = path.resolve(
        packagePath,
        relativeDependencyPath
      )
      localDependencyPaths.set(absoluteDependencyPath, {
        name: dependencyName,
        path: absoluteDependencyPath
      })
    }

    const dependencyPackages = [...localDependencyPaths.values()]
    return Promise.all(
      dependencyPackages.map(async (dependency) => ({
        ...dependency,
        frameworkRevision: await readSingleFrameworkRevisionForPackage(
          dependency.path
        )
      }))
    )
  } catch {
    return []
  }
}

const readSingleFrameworkRevisionForPackage = async (
  packagePath: string
): Promise<string | undefined> => {
  const lockPath = path.join(packagePath, "Move.lock")
  try {
    const lockContents = await fs.readFile(lockPath, "utf8")
    return extractSingleSuiFrameworkRevisionFromMoveLock({
      lockContents,
      environmentName: undefined
    })
  } catch {
    return undefined
  }
}

/**
 * Returns the installed Sui CLI version, if available.
 */
const getSuiCliVersion = async (): Promise<string | undefined> => {
  try {
    const { stdout, exitCode } = await runSuiCliVersion(["--version"])
    if (exitCode && exitCode !== 0) return undefined
    return parseSuiCliVersionOutput(stdout.toString())
  } catch {
    return undefined
  }
}

/**
 * Parses `sui --version` output into a version string.
 */
const parseSuiCliVersionOutput = (stdout: string): string | undefined => {
  if (!stdout?.trim()) return undefined
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? ""
  const versionMatch = firstLine.match(/sui\s+([^\s]+)/i)
  return (versionMatch?.[1] ?? firstLine) || undefined
}

/**
 * Detects publish errors caused by transaction size limits.
 */
const isSizeLimitError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : error ? String(error) : ""
  return (
    message.toLowerCase().includes("size limit exceeded") ||
    message.toLowerCase().includes("serialized transaction size")
  )
}

/**
 * Determines whether to retry publish via CLI when SDK payloads are too large.
 */
const shouldRetryWithCli = (plan: PublishPlan, error: unknown) =>
  !plan.useCliPublish && isSizeLimitError(error)

export const publishMovePackageWithFunding = async ({
  tooling,
  packagePath,
  gasBudget,
  withUnpublishedDependencies,
  allowAutoUnpublishedDependencies,
  useCliPublish = true,
  clearPublishedEntry = false
}: {
  tooling: Tooling
  packagePath: string
  gasBudget?: number
  withUnpublishedDependencies?: boolean
  allowAutoUnpublishedDependencies?: boolean
  useCliPublish?: boolean
  clearPublishedEntry?: boolean
}): Promise<PublishArtifact> => {
  const resolvedPackagePath = path.resolve(packagePath)
  if (clearPublishedEntry) {
    const { didUpdate } = await clearPublishedEntryForNetwork({
      packagePath: resolvedPackagePath,
      networkName: tooling.suiConfig.network.networkName
    })
    if (didUpdate) {
      logKeyValueBlue("Published.toml")(
        `cleared ${tooling.suiConfig.network.networkName} entry`
      )
    }
  }

  const artifacts = await tooling.withTestnetFaucetRetry(
    {
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    },
    async () =>
      tooling.publishPackageWithLog({
        packagePath: resolvedPackagePath,
        keypair: tooling.loadedEd25519KeyPair,
        gasBudget,
        withUnpublishedDependencies,
        useCliPublish,
        allowAutoUnpublishedDependencies
      })
  )

  return pickRootNonDependencyArtifact(artifacts)
}
