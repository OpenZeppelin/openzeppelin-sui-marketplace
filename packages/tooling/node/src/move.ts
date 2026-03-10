import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import path from "node:path"
import { runSuiCli } from "./suiCli.ts"

export { buildMovePackage, runMoveBuild } from "./move-build.ts"
export {
  clearPublishedEntryForNetwork,
  logLocalnetMoveEnvironmentSyncResult,
  resolveChainIdentifier,
  syncLocalnetMoveEnvironmentChainId,
  syncMoveEnvironmentChainId,
  type MoveEnvironmentChainIdSyncResult
} from "./move-toml.ts"

/**
 * Normalizes an absolute Move package path for stable comparisons.
 */
export const canonicalizePackagePath = (packagePath: string) =>
  path.normalize(path.resolve(packagePath))

/**
 * Resolves a package path relative to the Move root if it is not already under it.
 */
export const resolveFullPackagePath = (
  moveRootPath: string,
  providedPackagePath: string
): string => {
  const absoluteProvidedPath = path.isAbsolute(providedPackagePath)
    ? providedPackagePath
    : path.resolve(process.cwd(), providedPackagePath)
  const relativeToMoveRoot = path.relative(moveRootPath, absoluteProvidedPath)
  const isUnderMoveRoot =
    relativeToMoveRoot === "" || !relativeToMoveRoot.startsWith("..")

  return isUnderMoveRoot
    ? absoluteProvidedPath
    : path.resolve(moveRootPath, providedPackagePath)
}

/**
 * Checks whether a deployment artifact already exists for a package path.
 */
export const hasDeploymentForPackage = (
  deploymentArtifacts: PublishArtifact[],
  packagePath: string
) => {
  const normalizedTargetPath = canonicalizePackagePath(packagePath)
  return deploymentArtifacts.some(
    (artifact) =>
      canonicalizePackagePath(artifact.packagePath) === normalizedTargetPath
  )
}

export type MoveEnvironmentOptions = {
  environmentName?: string
  suiCliVersion?: string
}

export type MoveTestFlagOptions = MoveEnvironmentOptions

export type MoveCoverageSummaryFlagOptions = MoveEnvironmentOptions & {
  testOnly?: boolean
}

export type MoveTestPublishOptions = {
  buildEnvironmentName?: string
  suiCliVersion?: string
  publicationFilePath?: string
  withUnpublishedDependencies?: boolean
}

/**
 * Normalizes Move CLI environment names when they differ from Sui network names.
 */
export const resolveMoveCliEnvironmentName = (
  environmentName?: string
): string | undefined =>
  environmentName === "localnet" ? "test-publish" : environmentName

const parseSuiCliMajorMinorVersion = (
  suiCliVersion?: string
): { major: number; minor: number } | undefined => {
  if (!suiCliVersion) return

  const [majorSegment, minorSegment] = suiCliVersion.split(".")
  if (!majorSegment || !minorSegment) return

  const parseLeadingInteger = (segment: string): number | undefined => {
    let digitCount = 0
    for (const character of segment) {
      if (character < "0" || character > "9") break
      digitCount += 1
    }

    if (digitCount === 0) return

    const parsedNumber = Number(segment.slice(0, digitCount))
    if (!Number.isFinite(parsedNumber)) return
    if (!Number.isSafeInteger(parsedNumber)) return

    return parsedNumber
  }

  const major = parseLeadingInteger(majorSegment)
  const minor = parseLeadingInteger(minorSegment)
  if (major === undefined || minor === undefined) return

  return { major, minor }
}

const shouldUseLegacyMoveEnvironmentFlag = (suiCliVersion?: string) => {
  const parsedVersion = parseSuiCliMajorMinorVersion(suiCliVersion)
  if (!parsedVersion) return true

  return (
    parsedVersion.major < 1 ||
    (parsedVersion.major === 1 && parsedVersion.minor <= 65)
  )
}

const resolveMoveEnvironmentFlag = (suiCliVersion?: string) =>
  shouldUseLegacyMoveEnvironmentFlag(suiCliVersion)
    ? "--environment"
    : "--build-env"

/**
 * Builds CLI flags for Move commands that accept an environment.
 */
export const buildMoveEnvironmentFlags = ({
  environmentName,
  suiCliVersion
}: MoveEnvironmentOptions): string[] => {
  const resolvedEnvironmentName = resolveMoveCliEnvironmentName(environmentName)
  const resolvedEnvironmentFlag = resolveMoveEnvironmentFlag(suiCliVersion)

  return resolvedEnvironmentName
    ? [resolvedEnvironmentFlag, resolvedEnvironmentName]
    : []
}

/**
 * Builds CLI flags for `sui move test`.
 */
export const buildMoveTestFlags = ({
  environmentName,
  suiCliVersion
}: MoveTestFlagOptions): string[] =>
  buildMoveEnvironmentFlags({ environmentName, suiCliVersion })

/**
 * Builds full CLI arguments for `sui move test` including the package path.
 */
export const buildMoveTestArguments = ({
  packagePath,
  ...options
}: { packagePath: string } & MoveTestFlagOptions): string[] => [
  "--path",
  packagePath,
  ...buildMoveTestFlags(options)
]

const buildMoveCoverageSummaryFlags = ({
  environmentName,
  suiCliVersion,
  testOnly = false
}: MoveCoverageSummaryFlagOptions): string[] => [
  ...buildMoveEnvironmentFlags({ environmentName, suiCliVersion }),
  ...(testOnly ? ["--test"] : [])
]

/**
 * Builds full CLI arguments for `sui move coverage summary` including the package path.
 */
export const buildMoveCoverageSummaryArguments = ({
  packagePath,
  ...options
}: { packagePath: string } & MoveCoverageSummaryFlagOptions): string[] => [
  "--path",
  packagePath,
  ...buildMoveCoverageSummaryFlags(options)
]

const buildMoveTestPublishFlags = ({
  buildEnvironmentName,
  suiCliVersion,
  publicationFilePath,
  withUnpublishedDependencies
}: MoveTestPublishOptions): string[] => {
  const flags = buildMoveEnvironmentFlags({
    environmentName: buildEnvironmentName,
    suiCliVersion
  })
  if (publicationFilePath) flags.push("--pubfile-path", publicationFilePath)
  if (withUnpublishedDependencies) flags.push("--with-unpublished-dependencies")

  return flags
}

/**
 * Builds full CLI arguments for `sui client test-publish` including the package path.
 */
export const buildMoveTestPublishArguments = ({
  packagePath,
  ...options
}: { packagePath: string } & MoveTestPublishOptions): string[] => [
  packagePath,
  ...buildMoveTestPublishFlags(options)
]

/**
 * Returns a CLI runner for `sui move test`.
 */
export const runMoveTest = runSuiCli(["move", "test"])

/**
 * Returns a CLI runner for `sui move coverage summary`.
 */
export const runMoveCoverageSummary = runSuiCli(["move", "coverage", "summary"])

/**
 * Returns a CLI runner for `sui client test-publish`.
 */
export const runClientTestPublish = runSuiCli(["client", "test-publish"])
