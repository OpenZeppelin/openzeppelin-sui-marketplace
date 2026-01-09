import {
  ensureHexPrefix,
  normalizeHex
} from "@sui-oracle-market/tooling-core/hex"
import type { BuildOutput } from "@sui-oracle-market/tooling-core/types"
import { formatErrorMessage } from "@sui-oracle-market/tooling-core/utils/errors"
import fs from "node:fs/promises"
import path from "node:path"
import { logWarning } from "./log.ts"
import { collectJsonCandidates, tryParseJson } from "./json.ts"
import { runSuiCli } from "./suiCli.ts"
import { isErrnoWithCode } from "./utils/fs.ts"

/**
 * Builds a Move package and returns compiled modules plus dependency metadata.
 * Why: Publishing on Sui needs base64-encoded modules and resolved dependencies;
 * dependency addresses are derived from build artifacts for artifact recording.
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
  const dependencyAddresses =
    await resolveDependencyAddressesFromBuildArtifacts(resolvedPackagePath)

  if (buildExitCode !== undefined && buildExitCode !== 0) {
    logWarning(
      `sui move build returned non-zero exit code (${buildExitCode}) but JSON output was parsed.`
    )
  }

  return { modules, dependencies, dependencyAddresses }
}

/**
 * Returns a CLI runner for `sui move build`.
 */
export const runMoveBuild = runSuiCli(["move", "build"])

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
  for (const candidate of collectJsonCandidates(stdout)) {
    const parsed = tryParseJson(candidate)
    if (!parsed) continue
    const normalized = normalizeBuildJson(parsed)
    if (normalized) return normalized
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

const readBuildInfo = async (
  buildDir: string
): Promise<{ packageName: string; buildInfoRaw: string }> => {
  const packageName = await inferPackageName(buildDir)
  const buildInfoPath = await findBuildInfoPath(buildDir, packageName)
  const buildInfoRaw = await fs.readFile(buildInfoPath, "utf8")

  return { packageName, buildInfoRaw }
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
  const { packageName, buildInfoRaw } = await readBuildInfo(buildDir)

  const modules = await readBytecodeModules(
    buildDir,
    packageName,
    stripTestModules
  )
  const dependencies = extractDependencies(buildInfoRaw, packageName)

  return { modules, dependencies }
}

const resolveDependencyAddressesFromBuildArtifacts = async (
  resolvedPackagePath: string
): Promise<Record<string, string>> => {
  const buildDir = path.join(resolvedPackagePath, "build")

  try {
    const { packageName, buildInfoRaw } = await readBuildInfo(buildDir)
    return extractDependencyAddressMap(buildInfoRaw, packageName)
  } catch (error) {
    logWarning(
      `Failed to resolve dependency addresses from build artifacts: ${formatErrorMessage(
        error
      )}`
    )
    return {}
  }
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

const normalizeHexAddress = (address: string) =>
  ensureHexPrefix(normalizeHex(address.trim()))

type AddressAliasEntry = { alias: string; address: string }

const parseAddressAliasInstantiations = (
  buildInfoRaw: string
): AddressAliasEntry[] => {
  const addressSectionMatch = buildInfoRaw.match(
    /address_alias_instantiation:\s*\n((?:\s+[A-Za-z0-9_]+\s*:\s*"?0x?[0-9a-fA-F]{64}"?\s*\n)+)/
  )

  if (!addressSectionMatch) return []

  const dependenciesBlock = addressSectionMatch[1]
  const dependencyMatches = [
    ...dependenciesBlock.matchAll(
      /^\s+([A-Za-z0-9_]+)\s*:\s*"?0x?([0-9a-fA-F]{64})"?/gm
    )
  ]

  return dependencyMatches.map(([, alias, address]) => ({ alias, address }))
}

const buildDependencyAddressMap = (
  entries: AddressAliasEntry[],
  packageName: string
): Record<string, string> => {
  const normalizedPackageName = packageName.toLowerCase()

  return Object.fromEntries(
    entries
      .filter((entry) => entry.alias.toLowerCase() !== normalizedPackageName)
      .map((entry) => [entry.alias, normalizeHexAddress(entry.address)])
  )
}

/**
 * Extracts dependency addresses from BuildInfo.yaml.
 */
const extractDependencyAddressMap = (
  buildInfoRaw: string,
  packageName: string
): Record<string, string> =>
  buildDependencyAddressMap(
    parseAddressAliasInstantiations(buildInfoRaw),
    packageName
  )

const extractDependencies = (
  buildInfoRaw: string,
  packageName: string
): string[] =>
  Array.from(
    new Set(
      Object.values(extractDependencyAddressMap(buildInfoRaw, packageName))
    )
  )

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
