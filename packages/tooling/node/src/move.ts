import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import path from "node:path"
import { runSuiCli } from "./suiCli.ts"

export {
  clearPublishedEntryForNetwork,
  resolveChainIdentifier,
  syncLocalnetMoveEnvironmentChainId,
  syncMoveEnvironmentChainId,
  type MoveEnvironmentChainIdSyncResult
} from "./move-toml.ts"
export { buildMovePackage, runMoveBuild } from "./move-build.ts"

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
}

export type MoveTestFlagOptions = MoveEnvironmentOptions

export type MoveTestPublishOptions = {
  buildEnvironmentName?: string
  publicationFilePath?: string
  withUnpublishedDependencies?: boolean
}

/**
 * Builds CLI flags for Move commands that accept an environment.
 */
export const buildMoveEnvironmentFlags = ({
  environmentName
}: MoveEnvironmentOptions): string[] =>
  environmentName ? ["--environment", environmentName] : []

/**
 * Builds CLI flags for `sui move test`.
 */
export const buildMoveTestFlags = ({
  environmentName
}: MoveTestFlagOptions): string[] =>
  buildMoveEnvironmentFlags({ environmentName })

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

const buildMoveTestPublishFlags = ({
  buildEnvironmentName,
  publicationFilePath,
  withUnpublishedDependencies
}: MoveTestPublishOptions): string[] => {
  const flags: string[] = []

  if (buildEnvironmentName) flags.push("--build-env", buildEnvironmentName)
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
 * Returns a CLI runner for `sui client test-publish`.
 */
export const runClientTestPublish = runSuiCli(["client", "test-publish"])
