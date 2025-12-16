import fs from "node:fs/promises"
import path from "node:path"

import { SuiClient, type SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"
import {
  getDeploymentArtifactPath,
  writeDeploymentArtifact
} from "./artifacts.ts"
import type { SuiNetworkConfig } from "./config.ts"
import { DEFAULT_PUBLISH_GAS_BUDGET } from "./constants.ts"
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
 */
export const publishPackageWithLog = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    keypair,
    gasBudget = DEFAULT_PUBLISH_GAS_BUDGET,
    withUnpublishedDependencies = false,
    useDevBuild = false,
    useCliPublish = false,
    allowAutoUnpublishedDependencies = true
  }: {
    network: SuiNetworkConfig
    packagePath: string
    fullNodeUrl: string
    keypair: Ed25519Keypair
    gasBudget?: number
    withUnpublishedDependencies?: boolean
    useDevBuild?: boolean
    useCliPublish?: boolean
    allowAutoUnpublishedDependencies?: boolean
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
    useDevBuild,
    useCliPublish,
    allowAutoUnpublishedDependencies
  })

  logPublishStart(publishPlan)

  const artifacts = await publishPackage(publishPlan, initiatedSuiClient)

  logPublishSuccess(artifacts)

  return artifacts
}

/** Publishes a Move package according to a prepared plan. */
/**
 * Publishes a Move package according to a prepared plan (build flags, dep strategy).
 * Returns publish artifacts persisted to disk, similar to an EVM deploy receipt.
 */
export const publishPackage = async (
  publishPlan: PublishPlan,
  initiatedSuiClient?: SuiClient
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
      : await doPublishPackage(publishPlan, buildOutput, initiatedSuiClient)
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
  initiatedSuiClient?: SuiClient
): Promise<PublishResult> => {
  const suiClient =
    initiatedSuiClient || new SuiClient({ url: publishPlan.fullNodeUrl })

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
 * Creates a publish transaction that:
 * 1) sets sender/gas budget
 * 2) publishes the compiled modules
 * 3) transfers the upgrade cap back to the sender
 */
/**
 * Builds the publish transaction payload with gas budget, publish command, and upgrade-cap transfer.
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
const runSuiCliVersion = runSuiCli([])

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
  useDevBuild = false,
  useCliPublish = false,
  allowAutoUnpublishedDependencies = true
}: {
  network: SuiNetworkConfig
  packagePath: string
  fullNodeUrl: string
  keypair: Ed25519Keypair
  gasBudget: number
  withUnpublishedDependencies?: boolean
  useDevBuild?: boolean
  useCliPublish?: boolean
  allowAutoUnpublishedDependencies?: boolean
}): Promise<PublishPlan> => {
  const {
    unpublishedDependencies,
    shouldUseUnpublishedDependencies,
    lockMissing
  } = await resolveUnpublishedDependencyUsage(
    packagePath,
    withUnpublishedDependencies,
    allowAutoUnpublishedDependencies
  )

  if (
    !shouldSkipFrameworkConsistency(
      network.networkName,
      useDevBuild,
      allowAutoUnpublishedDependencies
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
      allowAutoUnpublishedDependencies,
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
    dependencyAddressesFromLock: await readDependencyAddresses(packagePath),
    useCliPublish: cliPublish,
    keystorePath: network.account?.keystorePath,
    suiCliVersion: await fetchSuiCliVersion(),
    packageNames: await resolvePackageNames(
      packagePath,
      unpublishedDependencies
    ),
    allowAutoUnpublishedDependencies,
    ignoreChainDuringBuild: shouldIgnoreChain(network.networkName, {
      allowAutoUnpublishedDependencies,
      useDevBuild
    })
  }
}

const SKIP_FETCH_LATEST_GIT_DEPS_FLAG = "--skip-fetch-latest-git-deps"
const DUMP_BYTECODE_AS_BASE64_FLAG = "--dump-bytecode-as-base64"
const shouldSkipFrameworkConsistency = (
  networkName: string,
  useDevBuild: boolean,
  allowAutoUnpublishedDependencies: boolean
) =>
  networkName === "localnet" || useDevBuild || allowAutoUnpublishedDependencies
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
): Promise<{ unpublishedDependencies: string[]; lockMissing: boolean }> => {
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

    return { unpublishedDependencies, lockMissing: false }
  } catch {
    return { unpublishedDependencies: [], lockMissing: true }
  }
}

/**
 * Decides whether --with-unpublished-dependencies should be used and returns the raw dep list.
 */
const resolveUnpublishedDependencyUsage = async (
  packagePath: string,
  explicitWithUnpublished?: boolean,
  allowImplicitUnpublished?: boolean
) => {
  const { unpublishedDependencies, lockMissing } =
    await findUnpublishedDependencies(packagePath)

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
const readDependencyAddresses = async (
  packagePath: string
): Promise<Record<string, string>> => {
  const lockPath = path.join(packagePath, "Move.lock")
  try {
    const lockContents = await fs.readFile(lockPath, "utf8")
    return parsePublishedAddresses(lockContents)
  } catch {
    return {}
  }
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

const buildFrameworkMismatchMessage = (mismatches: string[]) =>
  [
    "Framework version mismatch detected across Move.lock files.",
    ...mismatches.map((mismatch) => `- ${mismatch}`),
    "Align all packages to the same Sui framework commit (e.g., run `sui move update` in each package) before publishing."
  ].join("\n")

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

const fetchSuiCliVersion = async (): Promise<string | undefined> => {
  try {
    const { stdout, exitCode } = await runSuiCliVersion(["--version"])
    if (exitCode && exitCode !== 0) return undefined
    return parseSuiCliVersionOutput(stdout.toString())
  } catch {
    return undefined
  }
}

const parseSuiCliVersionOutput = (stdout: string): string | undefined => {
  if (!stdout?.trim()) return undefined
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? ""
  const versionMatch = firstLine.match(/sui\s+([^\s]+)/i)
  return (versionMatch?.[1] ?? firstLine) || undefined
}

/** Parses published addresses from a Move.lock blob keyed by package alias. */
const parsePublishedAddresses = (
  lockContents: string
): Record<string, string> => {
  const blocks = lockContents.split(/\[\[move\.package\]\]/).slice(1)
  const addresses: Record<string, string> = {}

  for (const block of blocks) {
    const idMatch = block.match(/id\s*=\s*"([^"]+)"/)
    const publishedMatch =
      block.match(/published-at\s*=\s*"0x([0-9a-fA-F]+)"/) ||
      block.match(/published-id\s*=\s*"0x([0-9a-fA-F]+)"/)

    if (idMatch && publishedMatch) {
      const alias = idMatch[1]
      const address = `0x${publishedMatch[1].toLowerCase()}`
      addresses[alias] = address
    }
  }

  return addresses
}

const isSizeLimitError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : error ? String(error) : ""
  return (
    message.toLowerCase().includes("size limit exceeded") ||
    message.toLowerCase().includes("serialized transaction size")
  )
}

const shouldRetryWithCli = (plan: PublishPlan, error: unknown) =>
  !plan.useCliPublish && isSizeLimitError(error)
