import type { SuiClient } from "@mysten/sui/client"
import type {
  BuildOutput,
  PublishArtifact
} from "@sui-oracle-market/tooling-core/types"
import fs from "node:fs/promises"
import path from "node:path"
import { logWarning } from "./log.ts"
import { getSuiCliEnvironmentChainId, runSuiCli } from "./suiCli.ts"

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

type MoveEnvironmentSyncResult = {
  updatedFiles: string[]
}

export type MoveEnvironmentChainIdSyncResult = {
  updatedFiles: string[]
  chainId?: string
  didAttempt: boolean
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const resolveLineEnding = (contents: string) =>
  contents.includes("\r\n") ? "\r\n" : "\n"

const getLineStartOffsets = (contents: string) => {
  const offsets = [0]
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n") offsets.push(index + 1)
  }
  return offsets
}

const listMoveTomlFiles = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true })
  const files: string[] = []

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await listMoveTomlFiles(fullPath)))
      } else if (entry.isFile() && entry.name === "Move.toml") {
        files.push(fullPath)
      }
    })
  )

  return files
}

const findSectionBlock = (
  contents: string,
  sectionName: string
): { block: string; start: number; end: number } | undefined => {
  const escapedSection = escapeRegExp(sectionName)
  const lines = contents.split(/\r?\n/)
  const lineOffsets = getLineStartOffsets(contents)
  const sectionHeaderRegex = new RegExp(
    `^\\s*\\[${escapedSection}\\]\\s*(#.*)?$`
  )
  const anySectionHeaderRegex = /^\s*\[[^\]]+\]\s*(#.*)?$/

  const headerIndex = lines.findIndex((line) => sectionHeaderRegex.test(line))
  if (headerIndex < 0) return undefined

  const nextHeaderIndex = lines.findIndex(
    (line, index) => index > headerIndex && anySectionHeaderRegex.test(line)
  )

  const start = lineOffsets[headerIndex] ?? 0
  const end =
    nextHeaderIndex >= 0
      ? (lineOffsets[nextHeaderIndex] ?? contents.length)
      : contents.length

  return { block: contents.slice(start, end), start, end }
}

const isErrnoWithCode = (error: unknown, code: string): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === code
  )

const trimLeadingEmptyLines = (contents: string) =>
  contents.replace(/^(?:\s*\r?\n)+/, "")

const trimTrailingEmptyLines = (contents: string) =>
  contents.replace(/(?:\r?\n\s*)+$/, "")

const ensureTrailingNewline = (
  contents: string,
  lineEnding: string,
  shouldPreserveTrailingNewline: boolean
) => {
  if (!shouldPreserveTrailingNewline) return contents
  return contents.endsWith("\n") ? contents : `${contents}${lineEnding}`
}

const removePublishedSectionForNetwork = (
  contents: string,
  networkName: string
): { updatedContents: string; didUpdate: boolean } => {
  const sectionName = `published.${networkName}`
  const sectionBlock = findSectionBlock(contents, sectionName)
  if (!sectionBlock) return { updatedContents: contents, didUpdate: false }

  const lineEnding = resolveLineEnding(contents)
  const shouldPreserveTrailingNewline = contents.endsWith("\n")
  const before = trimTrailingEmptyLines(contents.slice(0, sectionBlock.start))
  const after = trimLeadingEmptyLines(contents.slice(sectionBlock.end))
  const separator =
    before && after
      ? `${lineEnding}${lineEnding}`
      : before && !after
        ? lineEnding
        : ""
  const combined = `${before}${separator}${after}`

  return {
    updatedContents: ensureTrailingNewline(
      combined,
      lineEnding,
      shouldPreserveTrailingNewline
    ),
    didUpdate: true
  }
}

const hasDepReplacementSection = (contents: string, environmentName: string) =>
  new RegExp(
    `^\\s*\\[dep-replacements\\.${escapeRegExp(environmentName)}\\]\\s*(#.*)?$`,
    "m"
  ).test(contents)

const hasEnvironmentEntry = (contents: string, environmentName: string) => {
  const environmentBlock = findSectionBlock(contents, "environments")
  if (!environmentBlock) return false

  const entryRegex = new RegExp(
    `^\\s*${escapeRegExp(environmentName)}\\s*=\\s*"[^"]*"\\s*(#.*)?$`
  )

  return environmentBlock.block
    .split(/\r?\n/)
    .some((line) => entryRegex.test(line))
}

const resolveEnvironmentEntryIndent = (
  lines: string[],
  headerIndex: number
) => {
  const entryLine = lines.slice(headerIndex + 1).find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith("#")
  })
  return entryLine?.match(/^\s*/)?.[0] ?? ""
}

const updateEnvironmentBlock = ({
  block,
  environmentName,
  chainId
}: {
  block: string
  environmentName: string
  chainId: string
}): { updatedBlock: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(block)
  const lines = block.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) =>
    /^\s*\[environments\]\s*(#.*)?$/.test(line)
  )
  if (headerIndex < 0) return { updatedBlock: block, didUpdate: false }

  const escapedEnvironmentName = escapeRegExp(environmentName)
  const entryRegex = new RegExp(
    `^(\\s*)${escapedEnvironmentName}\\s*=\\s*"([^"]*)"(?:(\\s*#.*))?$`
  )
  const entryIndex = lines.findIndex((line) => entryRegex.test(line))

  if (entryIndex >= 0) {
    const match = lines[entryIndex]?.match(entryRegex)
    const existingChainId = match?.[2]
    if (existingChainId === chainId) {
      return { updatedBlock: block, didUpdate: false }
    }
    const indent = match?.[1] ?? ""
    const commentSuffix = match?.[3] ?? ""
    lines[entryIndex] =
      `${indent}${environmentName} = "${chainId}"${commentSuffix}`
    return { updatedBlock: lines.join(lineEnding), didUpdate: true }
  }

  const indent = resolveEnvironmentEntryIndent(lines, headerIndex)
  const lastContentIndex = (() => {
    for (let index = lines.length - 1; index > headerIndex; index -= 1) {
      if (lines[index].trim().length > 0) return index
    }
    return headerIndex
  })()
  const insertIndex = lastContentIndex + 1
  lines.splice(insertIndex, 0, `${indent}${environmentName} = "${chainId}"`)
  return { updatedBlock: lines.join(lineEnding), didUpdate: true }
}

const insertEnvironmentBlock = (contents: string, block: string): string => {
  const lineEnding = resolveLineEnding(contents)
  const normalizedBlock = block.split(/\r?\n/).join(lineEnding)
  const insertionMatch = contents.match(
    /^\s*\[(addresses|dev-dependencies)\]\s*(#.*)?$/m
  )

  if (insertionMatch?.index === undefined) {
    const prefix = contents.endsWith("\n")
      ? contents
      : `${contents}${lineEnding}`
    return `${prefix}${normalizedBlock}${lineEnding}`
  }

  const before = contents.slice(0, insertionMatch.index)
  const after = contents.slice(insertionMatch.index)

  const prefix = before.endsWith("\n") ? before : `${before}${lineEnding}`
  const suffix =
    after.startsWith("\n") || after.startsWith("\r\n")
      ? after
      : `${lineEnding}${after}`

  return `${prefix}${normalizedBlock}${suffix}`
}

const updateMoveTomlEnvironmentChainId = ({
  contents,
  environmentName,
  chainId
}: {
  contents: string
  environmentName: string
  chainId: string
}): { updatedContents: string; didUpdate: boolean } => {
  const lineEnding = resolveLineEnding(contents)
  const shouldManageEnvironment =
    hasDepReplacementSection(contents, environmentName) ||
    hasEnvironmentEntry(contents, environmentName)

  if (!shouldManageEnvironment) {
    return { updatedContents: contents, didUpdate: false }
  }

  const environmentBlock = findSectionBlock(contents, "environments")
  const newEntryBlock = `[environments]${lineEnding}${environmentName} = "${chainId}"`

  if (!environmentBlock) {
    return {
      updatedContents: insertEnvironmentBlock(contents, newEntryBlock),
      didUpdate: true
    }
  }

  const { updatedBlock, didUpdate } = updateEnvironmentBlock({
    block: environmentBlock.block,
    environmentName,
    chainId
  })
  if (!didUpdate) return { updatedContents: contents, didUpdate: false }

  return {
    updatedContents:
      contents.slice(0, environmentBlock.start) +
      updatedBlock +
      contents.slice(environmentBlock.end),
    didUpdate: true
  }
}

/**
 * Resolves the chain identifier from RPC, falling back to Sui CLI env config.
 */
export const resolveChainIdentifier = async ({
  suiClient,
  environmentName
}: {
  suiClient: SuiClient
  environmentName?: string
}): Promise<string | undefined> => {
  try {
    return await suiClient.getChainIdentifier()
  } catch {
    return await getSuiCliEnvironmentChainId(environmentName)
  }
}

/**
 * Ensures the Move.toml environments entry matches the localnet chain id.
 * Use dryRun to report drift without writing changes.
 */
export const syncLocalnetMoveEnvironmentChainId = async ({
  moveRootPath,
  environmentName,
  suiClient,
  dryRun = false
}: {
  moveRootPath: string
  environmentName: string | undefined
  suiClient: SuiClient
  dryRun?: boolean
}): Promise<MoveEnvironmentChainIdSyncResult> => {
  if (environmentName !== "localnet")
    return { updatedFiles: [], didAttempt: false }

  const chainId = await resolveChainIdentifier({
    suiClient,
    environmentName
  })

  if (!chainId) return { updatedFiles: [], chainId, didAttempt: true }

  const { updatedFiles } = await syncMoveEnvironmentChainId({
    moveRootPath,
    environmentName,
    chainId,
    dryRun
  })

  return { updatedFiles, chainId, didAttempt: true }
}

/**
 * Syncs Move.toml environment chain IDs under the provided move root.
 * Use dryRun to report potential updates without writing files.
 */
export const syncMoveEnvironmentChainId = async ({
  moveRootPath,
  environmentName,
  chainId,
  dryRun = false
}: {
  moveRootPath: string
  environmentName: string
  chainId: string
  dryRun?: boolean
}): Promise<MoveEnvironmentSyncResult> => {
  const updatedFiles: string[] = []

  try {
    const moveTomlFiles = await listMoveTomlFiles(moveRootPath)
    await Promise.all(
      moveTomlFiles.map(async (moveTomlPath) => {
        const contents = await fs.readFile(moveTomlPath, "utf8")
        const { updatedContents, didUpdate } = updateMoveTomlEnvironmentChainId(
          {
            contents,
            environmentName,
            chainId
          }
        )
        if (!didUpdate) return
        if (!dryRun) {
          await fs.writeFile(moveTomlPath, updatedContents)
        }
        updatedFiles.push(moveTomlPath)
      })
    )
  } catch (error) {
    logWarning(
      `Failed to sync Move.toml environments under ${moveRootPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return { updatedFiles }
}

export const clearPublishedEntryForNetwork = async ({
  packagePath,
  networkName
}: {
  packagePath: string
  networkName: string | undefined
}): Promise<{ publishedTomlPath: string; didUpdate: boolean }> => {
  const publishedTomlPath = path.join(packagePath, "Published.toml")
  if (!networkName) return { publishedTomlPath, didUpdate: false }

  let contents: string
  try {
    contents = await fs.readFile(publishedTomlPath, "utf8")
  } catch (error) {
    if (isErrnoWithCode(error, "ENOENT"))
      return { publishedTomlPath, didUpdate: false }
    throw error
  }

  const { updatedContents, didUpdate } = removePublishedSectionForNetwork(
    contents,
    networkName
  )
  if (!didUpdate) return { publishedTomlPath, didUpdate: false }

  await fs.writeFile(publishedTomlPath, updatedContents)
  return { publishedTomlPath, didUpdate: true }
}

/**
 * Builds a Move package and returns compiled modules + dependency addresses.
 * Why: Publishing on Sui needs base64-encoded modules and resolved dep addresses
 * (from Move.lock or build artifacts); this helper mirrors `sui move build` behavior
 * while allowing dev/test builds to strip test modules for publish.
 */
const ensureMoveBuildInstallDir = (
  buildArguments: string[],
  resolvedPackagePath: string
): string[] => {
  const hasInstallDir = buildArguments.some(
    (argument) =>
      argument === "--install-dir" || argument.startsWith("--install-dir=")
  )

  return hasInstallDir
    ? buildArguments
    : [...buildArguments, "--install-dir", resolvedPackagePath]
}

export const buildMovePackage = async (
  packagePath: string,
  buildArguments: string[] = [],
  options: { stripTestModules?: boolean } = {}
): Promise<BuildOutput> => {
  const { stripTestModules = false } = options
  const resolvedPackagePath = path.resolve(packagePath)
  if (!resolvedPackagePath)
    throw new Error(`Contracts not found at ${resolvedPackagePath}`)

  const resolvedBuildArguments = ensureMoveBuildInstallDir(
    buildArguments,
    resolvedPackagePath
  )
  const {
    stdout,
    stderr,
    exitCode: buildExitCode
  } = await runMoveBuild([
    "--path",
    resolvedPackagePath,
    ...resolvedBuildArguments
  ])
  const stdoutText = stdout?.toString() ?? ""
  const stderrText = stderr?.toString() ?? ""
  if (stderrText.trim()) logWarning(stderrText.trim())

  const { modules, dependencies } = await resolveBuildArtifacts(
    stdoutText,
    resolvedPackagePath,
    {
      stripTestModules,
      exitCode: buildExitCode,
      stderr: stderrText
    }
  )

  if (buildExitCode !== undefined && buildExitCode !== 0) {
    logWarning(
      `sui move build returned non-zero exit code (${buildExitCode}) but JSON output was parsed.`
    )
  }

  return { modules, dependencies }
}

/**
 * Returns a CLI runner for `sui move build`.
 */
export const runMoveBuild = runSuiCli(["move", "build"])

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

/**
 * Resolves build outputs from CLI JSON or the build/ artifacts on disk.
 */
const resolveBuildArtifacts = async (
  stdout: string,
  resolvedPackagePath: string,
  {
    stripTestModules = false,
    exitCode,
    stderr
  }: {
    stripTestModules?: boolean
    exitCode?: number
    stderr?: string
  } = {}
): Promise<BuildOutput> => {
  const parsed =
    parseBuildJson(stdout) ?? (stderr ? parseBuildJson(stderr) : undefined)
  const parsedModules = parsed?.modules ?? []
  const parsedDependencies = parsed?.dependencies ?? []
  const shouldReadArtifacts =
    stripTestModules ||
    parsedModules.length === 0 ||
    parsedDependencies.length === 0
  let fallback: { modules: string[]; dependencies: string[] } | undefined
  if (shouldReadArtifacts) {
    try {
      fallback = await readBuildArtifacts(resolvedPackagePath, {
        stripTestModules
      })
    } catch (error) {
      if (isErrnoWithCode(error, "ENOENT")) {
        const buildDir = path.join(resolvedPackagePath, "build")
        const codeSuffix =
          exitCode !== undefined ? ` (exit code ${exitCode})` : ""
        const outputTail = formatBuildOutputTail(stdout, stderr)
        throw new Error(
          `Move build did not emit bytecode output${codeSuffix} and no build artifacts were found at ${buildDir}.${outputTail}`
        )
      }
      throw error
    }
  }

  if (parsedModules.length === 0) {
    logWarning(
      "Build JSON contained no modules; using compiled artifacts from build/ instead."
    )
  } else if (stripTestModules && fallback?.modules?.length) {
    logWarning(
      "Using compiled artifacts to strip test modules (BuildInfo.yaml)."
    )
  }

  const modules = stripTestModules
    ? fallback?.modules ||
      parsedModules.filter((module) => !isTestModuleBytecode(module))
    : parsedModules.length > 0
      ? parsedModules
      : fallback?.modules || []
  const dependencies =
    parsedDependencies.length > 0
      ? parsedDependencies
      : fallback?.dependencies || []

  if (!modules.length) {
    const codeSuffix = exitCode !== undefined ? ` (exit code ${exitCode})` : ""
    const outputTail = formatBuildOutputTail(stdout, stderr)
    throw new Error(
      `Unexpected build output${codeSuffix}. Ensure the package builds correctly.${outputTail}`
    )
  }

  return { modules, dependencies }
}

/**
 * Extracts and parses the JSON payload emitted by `sui move build --dump-bytecode-as-base64`.
 * Warnings or info logs sometimes precede the JSON, so we search from the end.
 */
const parseBuildJson = (
  stdout: string
): { modules: string[]; dependencies: string[] } | undefined => {
  const normalizedOutput = stdout.trim()
  if (!normalizedOutput) return

  const candidates: string[] = [normalizedOutput]

  const lines = normalizedOutput.split(/\r?\n/)
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx]?.trimStart()
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) continue
    candidates.push(lines.slice(idx).join("\n").trim())
    break
  }

  const trailingBlockMatch = normalizedOutput.match(
    /(\{[\s\S]*\}|\[[\s\S]*\])\s*$/
  )
  if (trailingBlockMatch?.[1]) {
    candidates.push(trailingBlockMatch[1].trim())
  }

  const firstBrace = normalizedOutput.indexOf("{")
  const lastBrace = normalizedOutput.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(normalizedOutput.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate)
    if (!parsed) continue
    const normalized = normalizeBuildJson(parsed)
    if (normalized) return normalized
  }
}

const tryParseJson = (candidate: string): unknown | undefined => {
  try {
    return JSON.parse(candidate)
  } catch {
    return undefined
  }
}

const normalizeBuildJson = (
  parsed: unknown
): { modules: string[]; dependencies: string[] } | undefined => {
  if (!parsed || typeof parsed !== "object") return

  const payload = parsed as Record<string, unknown>
  const modules = normalizeModuleList(
    payload.modules ??
      payload.compiledModules ??
      payload.compiled_modules ??
      payload.bytecodeModules ??
      payload.bytecode_modules
  )
  const dependencies = normalizeDependencyList(
    payload.dependencies ??
      payload.dependencyIds ??
      payload.dependency_ids ??
      payload.deps ??
      payload.packageDependencies ??
      payload.package_dependencies
  )

  if (!modules.length && !dependencies.length) return
  return { modules, dependencies }
}

const normalizeModuleList = (modules: unknown): string[] => {
  if (!Array.isArray(modules)) return []
  if (modules.every((item) => typeof item === "string"))
    return modules as string[]

  const normalized = modules
    .map((item) => {
      if (typeof item === "string") return item
      if (Array.isArray(item)) {
        const lastItem = item[item.length - 1]
        return typeof lastItem === "string" ? lastItem : undefined
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>
        const candidate =
          record.bytecode ??
          record.bytes ??
          record.module ??
          record.moduleBytes ??
          record.module_bytes ??
          record.module_base64 ??
          record.base64 ??
          record.data
        return typeof candidate === "string" ? candidate : undefined
      }
      return undefined
    })
    .filter((item): item is string => Boolean(item))

  return normalized
}

const normalizeDependencyList = (dependencies: unknown): string[] => {
  if (!Array.isArray(dependencies)) return []
  if (dependencies.every((item) => typeof item === "string"))
    return dependencies as string[]

  return dependencies
    .map((item) => {
      if (typeof item === "string") return item
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>
        const candidate =
          record.address ??
          record.id ??
          record.packageId ??
          record.package_id ??
          record.package ??
          record.dependency
        return typeof candidate === "string" ? candidate : undefined
      }
      return undefined
    })
    .filter((item): item is string => Boolean(item))
}

const formatBuildOutputTail = (stdout: string, stderr?: string): string => {
  const chunks = [stderr, stdout].filter((chunk): chunk is string =>
    Boolean(chunk && chunk.trim())
  )
  if (!chunks.length) return ""

  const combined = chunks.join("\n").trim()
  const lines = combined.split(/\r?\n/)
  const tail = lines.slice(-20).join("\n")
  const maxChars = 2000
  const trimmed =
    tail.length > maxChars ? `${tail.slice(0, maxChars)}\n...` : tail

  return `\nSui CLI output (tail):\n${trimmed}`
}

/**
 * Reads compiled bytecode from the build directory and base64-encodes it.
 * Useful when `sui move build --dump-bytecode-as-base64` does not emit modules.
 */
const readBuildArtifacts = async (
  resolvedPackagePath: string,
  { stripTestModules = false }: { stripTestModules?: boolean } = {}
): Promise<{ modules: string[]; dependencies: string[] }> => {
  const buildDir = path.join(resolvedPackagePath, "build")
  const packageName = await inferPackageName(buildDir)

  const buildInfoPath = await findBuildInfoPath(buildDir, packageName)
  const buildInfoRaw = await fs.readFile(buildInfoPath, "utf8")

  const modules = await readBytecodeModules(
    buildDir,
    packageName,
    stripTestModules
  )
  const dependencies = extractDependencies(buildInfoRaw, packageName)

  return { modules, dependencies }
}

/**
 * Infers the Move package name from the build/ directory.
 */
const inferPackageName = async (buildDir: string): Promise<string> => {
  const buildEntries = await fs.readdir(buildDir, { withFileTypes: true })
  const candidateDirs = buildEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  // Prefer a directory that actually contains BuildInfo.yaml (skips lock dirs).
  for (const dir of candidateDirs) {
    try {
      await fs.access(path.join(buildDir, dir, "BuildInfo.yaml"))
      return dir
    } catch {
      /* keep scanning */
    }
  }

  // Fallback: pick the first non-metadata directory, then any, then a dummy name.
  return (
    candidateDirs.find((name) => name !== "locks" && name !== "deps") ||
    candidateDirs[0]
  )
}

/**
 * Finds the BuildInfo.yaml file for a built Move package.
 */
const findBuildInfoPath = async (
  buildDir: string,
  packageName: string
): Promise<string> => {
  const packageRoot = path.join(buildDir, packageName)
  const targets = [packageRoot]
  const buildInfoFilename = "BuildInfo.yaml"

  while (targets.length) {
    const currentDir = targets.pop()
    if (!currentDir) continue

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name)
        if (entry.isFile() && entry.name === buildInfoFilename) {
          return entryPath
        }
        if (entry.isDirectory()) {
          targets.push(entryPath)
        }
      }
    } catch {
      continue
    }
  }

  throw new Error(
    `BuildInfo.yaml not found under ${packageRoot}. Ensure the package was built successfully.`
  )
}

/**
 * Reads compiled Move bytecode modules and returns base64-encoded strings.
 */
const readBytecodeModules = async (
  buildDir: string,
  packageName: string,
  stripTestModules: boolean
): Promise<string[]> => {
  const bytecodeDir = path.join(buildDir, packageName, "bytecode_modules")
  const bytecodeEntries = await fs.readdir(bytecodeDir, {
    withFileTypes: true
  })

  const moduleFiles = bytecodeEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".mv") &&
        !(stripTestModules && isTestModuleFilename(entry.name))
    )
    .map((entry) => path.join(bytecodeDir, entry.name))
    .sort()

  const modules: string[] = []
  for (const filePath of moduleFiles) {
    const contents = await fs.readFile(filePath)
    modules.push(contents.toString("base64"))
  }

  return modules
}

/**
 * Extracts dependency addresses from BuildInfo.yaml.
 */
const extractDependencies = (
  buildInfoRaw: string,
  packageName: string
): string[] => {
  const addressSectionMatch = buildInfoRaw.match(
    /address_alias_instantiation:\s*\n((?:\s+[A-Za-z0-9_]+\s*:\s*"?[0-9a-fA-F]{64}"?\s*\n)+)/
  )

  if (!addressSectionMatch) return []

  const dependenciesBlock = addressSectionMatch[1]
  const dependencyMatches = [
    ...dependenciesBlock.matchAll(
      /^\s+([A-Za-z0-9_]+)\s*:\s*"?([0-9a-fA-F]{64})"?/gm
    )
  ]

  return dependencyMatches
    .map(([, alias, address]) => ({ alias, address }))
    .filter(({ alias }) => alias.toLowerCase() !== packageName.toLowerCase())
    .map(({ address }) => `0x${address.toLowerCase()}`)
    .filter((address, index, all) => all.indexOf(address) === index)
}

/**
 * Returns true if a bytecode filename is likely a test module.
 */
const isTestModuleFilename = (filename: string): boolean => {
  const lowered = filename.toLowerCase()
  return (
    lowered.endsWith("_tests.mv") ||
    lowered.endsWith("_test.mv") ||
    lowered.startsWith("test_")
  )
}

/**
 * Heuristically detects test modules from decoded bytecode.
 */
const isTestModuleBytecode = (moduleB64: string): boolean => {
  try {
    const bytes = Buffer.from(moduleB64, "base64")
    const decoded = new TextDecoder().decode(bytes).toLowerCase()
    return (
      decoded.includes("_tests") ||
      decoded.includes("_test") ||
      decoded.includes("test::") ||
      decoded.includes("::test_")
    )
  } catch {
    return false
  }
}
