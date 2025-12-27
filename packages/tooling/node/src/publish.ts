import fs from "node:fs/promises"
import path from "node:path"

import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { buildExplorerUrl } from "@sui-oracle-market/tooling-core/network"
import {
  deriveRelevantPackageId,
  getSuiObject
} from "@sui-oracle-market/tooling-core/object"
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
  writeDeploymentArtifact
} from "./artifacts.ts"
import type { SuiNetworkConfig } from "./config.ts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "./constants.ts"
import type { ToolingContext } from "./factory.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logSimpleBlue,
  logSimpleGreen,
  logWarning
} from "./log.ts"
import {
  findUnpublishedDependenciesInLock,
  normalizeDependencyId,
  parsePublishedAddressesFromLock,
  resolveAllowedDependencyIds,
  updateMoveLockPublishedAddresses
} from "./move-lock.ts"
import { buildMovePackage } from "./move.ts"
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
  dependencyAddressesFromLock: Record<string, string>
  useCliPublish?: boolean
  keystorePath?: string
  useDevBuild?: boolean
  suiCliVersion?: string
  allowAutoUnpublishedDependencies?: boolean
  ignoreChainDuringBuild: boolean
}

/**
 * Builds and publishes a Move package, logging friendly output and persisting artifacts.
 * Why: Publishing on Sui requires bundling compiled modules, dependency addresses, and gas strategy;
 * this helper mirrors common EVM “deploy script” ergonomics while honoring Sui-specific constraints
 * (unpublished deps, Move.lock addresses, UpgradeCap transfer).
 *
 * Note: This will update Move.lock with published-at addresses for the active network
 * (using configured dependency addresses + Pyth package lookup) before publishing,
 * so consumers only need to switch Sui config/network.
 */
export const publishPackageWithLog = async (
  {
    packagePath,
    keypair,
    gasBudget = DEFAULT_PUBLISH_GAS_BUDGET,
    withUnpublishedDependencies = false,
    useDevBuild = false,
    useCliPublish = false,
    allowAutoUnpublishedDependencies = true
  }: {
    packagePath: string
    keypair: Ed25519Keypair
    gasBudget?: number
    withUnpublishedDependencies?: boolean
    useDevBuild?: boolean
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
    useDevBuild,
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
 * Returns publish artifacts persisted to disk, similar to an EVM deploy receipt.
 *
 * Note: The publish plan is prepared after ensuring Move.lock is up to date for the
 * active network, so dependency address resolution matches the current environment.
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

  const dependencyAddresses = mergeDependencyAddresses(
    publishPlan.dependencyAddressesFromLock,
    publishResult.packages
  )

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
 * Builds the publish transaction payload with gas budget, publish command, and upgrade-cap transfer.
 */
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
  useDevBuild = false,
  useCliPublish = false,
  allowAutoUnpublishedDependencies = true
}: {
  network: SuiNetworkConfig
  packagePath: string
  fullNodeUrl: string
  keypair: Ed25519Keypair
  suiClient: SuiClient
  gasBudget: number
  withUnpublishedDependencies?: boolean
  useDevBuild?: boolean
  useCliPublish?: boolean
  allowAutoUnpublishedDependencies?: boolean
}): Promise<PublishPlan> => {
  if (network.networkName !== "localnet") {
    if (useDevBuild)
      throw new Error(
        "Dev builds are limited to localnet. Remove --dev when publishing to shared networks."
      )
    if (withUnpublishedDependencies)
      throw new Error(
        "--with-unpublished-dependencies is reserved for localnet. Link to published packages in Move.lock for shared networks."
      )
  }

  const allowImplicitUnpublishedDependencies =
    network.networkName === "localnet"
      ? allowAutoUnpublishedDependencies
      : false

  const initialMoveLockContents = await readMoveLockContents(packagePath)

  const updatedMoveLockContents = await ensureMoveLockPublishedAddresses({
    packagePath,
    lockContents: initialMoveLockContents,
    network,
    includeDevDependencies: useDevBuild,
    suiClient
  })

  const moveLockContents = updatedMoveLockContents ?? initialMoveLockContents

  const {
    unpublishedDependencies,
    shouldUseUnpublishedDependencies,
    lockMissing
  } = await resolveUnpublishedDependencyUsage(
    packagePath,
    withUnpublishedDependencies,
    allowImplicitUnpublishedDependencies,
    useDevBuild,
    moveLockContents
  )

  if (
    !shouldSkipFrameworkConsistency(
      network.networkName,
      useDevBuild,
      allowImplicitUnpublishedDependencies
    )
  ) {
    await assertFrameworkRevisionConsistency(packagePath)
  }

  const implicitlyEnabledUnpublishedDeps =
    (unpublishedDependencies.length > 0 || lockMissing) &&
    !withUnpublishedDependencies &&
    shouldUseUnpublishedDependencies

  if (implicitlyEnabledUnpublishedDeps) {
    logWarning(
      lockMissing
        ? `Enabling --with-unpublished-dependencies for ${packagePath} (Move.lock missing; cannot resolve published dependency addresses).`
        : `Enabling --with-unpublished-dependencies for ${packagePath} (unpublished packages: ${unpublishedDependencies.join(
            ", "
          )})`
    )
  }

  const buildFlags = buildMoveBuildFlags({
    useDevBuild,
    includeUnpublishedDeps: Boolean(shouldUseUnpublishedDependencies),
    ignoreChain: shouldIgnoreChain(network.networkName, {
      allowAutoUnpublishedDependencies: allowImplicitUnpublishedDependencies,
      useDevBuild
    })
  })

  // Prefer CLI for standard publishes; dev builds fall back to SDK because
  // Sui CLI rejects packages that require test-only code (e.g. std::unit_test).
  const cliPublish = useCliPublish || !useDevBuild

  return {
    network,
    packagePath,
    fullNodeUrl,
    keypair,
    gasBudget,
    useDevBuild,
    shouldUseUnpublishedDependencies: Boolean(shouldUseUnpublishedDependencies),
    unpublishedDependencies,
    buildFlags,
    dependencyAddressesFromLock: readDependencyAddresses(
      moveLockContents,
      useDevBuild
    ),
    useCliPublish: cliPublish,
    keystorePath: network.account?.keystorePath,
    suiCliVersion: await getSuiCliVersion(),
    packageNames: await resolvePackageNames(
      packagePath,
      unpublishedDependencies
    ),
    allowAutoUnpublishedDependencies: allowImplicitUnpublishedDependencies,
    ignoreChainDuringBuild: shouldIgnoreChain(network.networkName, {
      allowAutoUnpublishedDependencies: allowImplicitUnpublishedDependencies,
      useDevBuild
    })
  }
}

const SKIP_FETCH_LATEST_GIT_DEPS_FLAG = "--skip-fetch-latest-git-deps"
const DUMP_BYTECODE_AS_BASE64_FLAG = "--dump-bytecode-as-base64"
/**
 * Determines whether to skip framework revision checks for the given network/build mode.
 */
const shouldSkipFrameworkConsistency = (
  networkName: string,
  useDevBuild: boolean,
  allowAutoUnpublishedDependencies: boolean
) =>
  networkName === "localnet" || useDevBuild || allowAutoUnpublishedDependencies
/**
 * Determines whether to pass --ignore-chain for Move builds.
 */
const shouldIgnoreChain = (
  networkName: string,
  {
    allowAutoUnpublishedDependencies,
    useDevBuild
  }: { allowAutoUnpublishedDependencies: boolean; useDevBuild: boolean }
) =>
  networkName === "localnet" ||
  (allowAutoUnpublishedDependencies && useDevBuild)

/**
 * Derives the Move build flags for publishing.
 */
const buildMoveBuildFlags = ({
  useDevBuild,
  includeUnpublishedDeps,
  ignoreChain
}: {
  useDevBuild: boolean
  includeUnpublishedDeps: boolean
  ignoreChain: boolean
}) => {
  const flags = [DUMP_BYTECODE_AS_BASE64_FLAG, SKIP_FETCH_LATEST_GIT_DEPS_FLAG]
  if (useDevBuild) {
    flags.push("--dev", "--test")
  }
  if (includeUnpublishedDeps) flags.push("--with-unpublished-dependencies")
  if (ignoreChain) flags.push("--ignore-chain")

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

/** Combines dependency addresses from Move.lock with newly published dependency packages. */
const mergeDependencyAddresses = (
  lockAddresses: Record<string, string>,
  publishedPackages: PublishedPackage[]
) => {
  const publishedDependencyAddresses = publishedPackages
    .filter(
      (publishedPackage) =>
        publishedPackage.isDependency && publishedPackage.packageName
    )
    .reduce<Record<string, string>>((acc, publishedPackage) => {
      acc[publishedPackage.packageName as string] = publishedPackage.packageId
      return acc
    }, {})

  return { ...lockAddresses, ...publishedDependencyAddresses }
}

/**
 * Builds CLI arguments for `sui client publish`.
 */
const buildCliPublishArguments = (plan: PublishPlan): string[] => {
  const args = [
    plan.packagePath,
    "--json",
    "--gas-budget",
    plan.gasBudget.toString(),
    SKIP_FETCH_LATEST_GIT_DEPS_FLAG,
    "--sender",
    plan.keypair.toSuiAddress()
  ]

  if (plan.useDevBuild) args.push("--dev")

  if (plan.shouldUseUnpublishedDependencies)
    args.push("--with-unpublished-dependencies")

  return args
}

/**
 * Publishes using `sui client publish` to mirror CLI behavior (including Move.lock updates).
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

const resolveMoveLockPath = (packagePath: string) =>
  path.join(packagePath, "Move.lock")

const readMoveLockContents = async (
  packagePath: string
): Promise<string | undefined> => {
  const lockPath = resolveMoveLockPath(packagePath)
  try {
    return await fs.readFile(lockPath, "utf8")
  } catch {
    return undefined
  }
}

const writeMoveLockContents = async (packagePath: string, contents: string) => {
  const lockPath = resolveMoveLockPath(packagePath)
  await fs.writeFile(lockPath, contents)
}

/**
 * Finds dependencies that do not advertise a published address in Move.lock.
 */
const findUnpublishedDependencies = (
  lockContents: string | undefined,
  includeDevDependencies = true
): { unpublishedDependencies: string[]; lockMissing: boolean } => {
  if (!lockContents)
    return {
      unpublishedDependencies: [],
      lockMissing: true
    }

  const unpublishedDependencies = findUnpublishedDependenciesInLock(
    lockContents,
    { includeDevDependencies }
  )

  return { unpublishedDependencies, lockMissing: false }
}

const shouldResolveDependencyId = (
  dependencyId: string,
  allowedDependencyIds?: Set<string>
) =>
  !allowedDependencyIds ||
  allowedDependencyIds.has(normalizeDependencyId(dependencyId))

const filterDependencyAddressMap = (
  dependencyAddresses: DependencyAddressMap,
  allowedDependencyIds?: Set<string>
): DependencyAddressMap => {
  if (!allowedDependencyIds) return dependencyAddresses

  return Object.fromEntries(
    Object.entries(dependencyAddresses).filter(([dependencyId]) =>
      allowedDependencyIds.has(normalizeDependencyId(dependencyId))
    )
  )
}

const hasDependencyAddress = (
  dependencyAddresses: DependencyAddressMap,
  dependencyId: string
) =>
  Object.keys(dependencyAddresses).some(
    (key) => normalizeDependencyId(key) === normalizeDependencyId(dependencyId)
  )

const resolvePythPackageId = async ({
  network,
  allowedDependencyIds,
  suiClient,
  configuredAddresses
}: {
  network: SuiNetworkConfig
  allowedDependencyIds?: Set<string>
  suiClient: SuiClient
  configuredAddresses: DependencyAddressMap
}): Promise<string | undefined> => {
  if (!shouldResolveDependencyId("Pyth", allowedDependencyIds)) return undefined
  if (hasDependencyAddress(configuredAddresses, "Pyth")) return undefined

  const pythStateId = network.pyth?.pythStateId
  if (!pythStateId) return undefined

  const { object } = await getSuiObject(
    {
      objectId: pythStateId,
      options: { showType: true }
    },
    { suiClient }
  )

  if (!object.type)
    throw new Error(`Pyth state object ${pythStateId} did not return a type.`)

  return deriveRelevantPackageId(object.type)
}

const resolveDependencyAddressesForNetwork = async ({
  network,
  allowedDependencyIds,
  suiClient
}: {
  network: SuiNetworkConfig
  allowedDependencyIds?: Set<string>
  suiClient: SuiClient
}): Promise<DependencyAddressMap> => {
  const configuredAddresses = network.move?.dependencyAddresses ?? {}
  const resolvedAddresses: DependencyAddressMap = { ...configuredAddresses }

  const pythPackageId = await resolvePythPackageId({
    network,
    allowedDependencyIds,
    suiClient,
    configuredAddresses
  })

  if (pythPackageId) {
    resolvedAddresses.Pyth = pythPackageId
  }

  return filterDependencyAddressMap(resolvedAddresses, allowedDependencyIds)
}

const ensureMoveLockPublishedAddresses = async ({
  packagePath,
  lockContents,
  network,
  includeDevDependencies,
  suiClient
}: {
  packagePath: string
  lockContents: string | undefined
  network: SuiNetworkConfig
  includeDevDependencies: boolean
  suiClient: SuiClient
}): Promise<string | undefined> => {
  if (!lockContents) return lockContents
  if (network.networkName === "localnet") return lockContents

  const allowedDependencyIds = resolveAllowedDependencyIds(
    lockContents,
    includeDevDependencies
  )

  const dependencyAddresses = await resolveDependencyAddressesForNetwork({
    network,
    allowedDependencyIds,
    suiClient
  })

  if (Object.keys(dependencyAddresses).length === 0) return lockContents

  const { updatedContents, updatedDependencies } =
    updateMoveLockPublishedAddresses(lockContents, dependencyAddresses)

  if (updatedContents === lockContents) return lockContents

  await writeMoveLockContents(packagePath, updatedContents)

  if (updatedDependencies.length) {
    logKeyValueBlue("Move.lock")(
      `updated ${updatedDependencies.length} dependencies`
    )
  }

  return updatedContents
}

/**
 * Decides whether --with-unpublished-dependencies should be used and returns the raw dep list.
 */
const resolveUnpublishedDependencyUsage = async (
  packagePath: string,
  explicitWithUnpublished?: boolean,
  allowImplicitUnpublished?: boolean,
  includeDevDependencies = true,
  lockContents?: string
) => {
  const { unpublishedDependencies, lockMissing } = findUnpublishedDependencies(
    lockContents,
    includeDevDependencies
  )

  if (lockMissing && !allowImplicitUnpublished && !explicitWithUnpublished) {
    throw new Error(buildMissingMoveLockError(packagePath))
  }

  const shouldUseUnpublishedDependencies =
    explicitWithUnpublished ||
    (allowImplicitUnpublished &&
      (unpublishedDependencies.length > 0 || lockMissing))

  if (unpublishedDependencies.length > 0 && !shouldUseUnpublishedDependencies) {
    throw new Error(
      buildUnpublishedDependencyError(packagePath, unpublishedDependencies)
    )
  }

  return {
    unpublishedDependencies,
    shouldUseUnpublishedDependencies,
    lockMissing
  }
}

/**
 * Builds a helpful error message for unpublished dependencies.
 */
const buildUnpublishedDependencyError = (
  packagePath: string,
  unpublishedDependencies: string[]
) =>
  [
    `Unpublished dependencies detected for ${packagePath}: ${unpublishedDependencies.join(
      ", "
    )}.`,
    "Publishing to shared networks requires linking to already deployed packages.",
    "Add published addresses to Move.lock (or pass --with-unpublished-dependencies only on localnet) before publishing."
  ].join("\n")

/**
 * Builds a helpful error message when Move.lock is missing.
 */
const buildMissingMoveLockError = (packagePath: string) =>
  [
    `Move.lock not found for ${packagePath}.`,
    "Publishing to shared networks requires a Move.lock that pins dependency addresses to deployed packages.",
    "Run `sui move build --skip-fetch-latest-git-deps` against the intended dependency set or copy an existing Move.lock before publishing."
  ].join("\n")

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

/**
 * Reads Move.lock for published-at/published-id addresses keyed by package id/name.
 */
const readDependencyAddresses = (
  lockContents: string | undefined,
  includeDevDependencies = true
): Record<string, string> => {
  if (!lockContents) return {}

  return parsePublishedAddressesFromLock(lockContents, {
    includeDevDependencies
  })
}

/** Ensures the root package and any local dependencies share the same framework git revision. */
const assertFrameworkRevisionConsistency = async (packagePath: string) => {
  const rootFrameworkRevision =
    await readFrameworkRevisionForPackage(packagePath)
  if (!rootFrameworkRevision) return

  const dependencyPackages = await discoverLocalDependencyPackages(packagePath)
  const mismatchedRevisions = collectMismatchedFrameworkRevisions(
    rootFrameworkRevision,
    dependencyPackages
  )

  if (mismatchedRevisions.length) {
    throw new Error(buildFrameworkMismatchMessage(mismatchedRevisions))
  }
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
    "Align all packages to the same Sui framework commit (e.g., run `sui move update` in each package) before publishing."
  ].join("\n")

/**
 * Reads the Sui framework revision for a package from Move.lock.
 */
const readFrameworkRevisionForPackage = async (
  packagePath: string
): Promise<string | undefined> => {
  const lockPath = path.join(packagePath, "Move.lock")
  try {
    const lockContents = await fs.readFile(lockPath, "utf8")
    return extractFrameworkRevisionFromLock(lockContents)
  } catch {
    return undefined
  }
}

/**
 * Extracts the framework revision from a Move.lock file contents.
 */
const extractFrameworkRevisionFromLock = (
  lockContents: string
): string | undefined => {
  const packageBlocks = lockContents.split(/\[\[move\.package\]\]/).slice(1)
  for (const packageBlock of packageBlocks) {
    const isFrameworkBlock =
      /id\s*=\s*"Bridge"/i.test(packageBlock) ||
      /id\s*=\s*"Sui"/i.test(packageBlock)
    if (!isFrameworkBlock) continue

    const revisionMatch = packageBlock.match(/rev\s*=\s*"([^"]+)"/)
    if (revisionMatch) return revisionMatch[1]
  }
  return undefined
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
        frameworkRevision: await readFrameworkRevisionForPackage(
          dependency.path
        )
      }))
    )
  } catch {
    return []
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
