import type {
  BuildOutput,
  PublishArtifact
} from "@sui-oracle-market/tooling-core/types"
import fs from "node:fs/promises"
import path from "node:path"
import { exitCode } from "node:process"
import { logWarning } from "./log.ts"
import { runSuiCli } from "./suiCli.ts"

/**
 * Normalizes an absolute Move package path for stable comparisons.
 */
export const canonicalizePackagePath = (packagePath: string) =>
  path.normalize(path.resolve(packagePath))

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

/**
 * Builds a Move package and returns compiled modules + dependency addresses.
 * Why: Publishing on Sui needs base64-encoded modules and resolved dep addresses
 * (from Move.lock or build artifacts); this helper mirrors `sui move build` behavior
 * while allowing dev/test builds to strip test modules for publish.
 */
export const buildMovePackage = async (
  packagePath: string,
  buildArguments: string[] = [],
  options: { stripTestModules?: boolean } = {}
): Promise<BuildOutput> => {
  const { stripTestModules = false } = options
  const resolvedPackagePath = path.resolve(packagePath)
  if (!resolvedPackagePath)
    throw new Error(`Contracts not found at ${resolvedPackagePath}`)

  const { stdout, stderr } = await runMoveBuild([
    "--path",
    resolvedPackagePath,
    ...buildArguments
  ])
  if (stderr) logWarning(stderr.toString())

  const { modules, dependencies } = await resolveBuildArtifacts(
    stdout.toString(),
    resolvedPackagePath,
    { stripTestModules }
  )

  if (exitCode !== undefined && exitCode !== 0) {
    logWarning(
      `sui move build returned non-zero exit code (${exitCode}) but JSON output was parsed.`
    )
  }

  return { modules, dependencies }
}

export const runMoveBuild = runSuiCli(["move", "build"])

const resolveBuildArtifacts = async (
  stdout: string,
  resolvedPackagePath: string,
  {
    stripTestModules = false
  }: {
    stripTestModules?: boolean
  } = {}
): Promise<BuildOutput> => {
  const parsed = parseBuildJson(stdout)
  const parsedModules = parsed?.modules ?? []
  const parsedDependencies = parsed?.dependencies ?? []
  const shouldReadArtifacts =
    stripTestModules ||
    parsedModules.length === 0 ||
    parsedDependencies.length === 0
  const fallback = shouldReadArtifacts
    ? await readBuildArtifacts(resolvedPackagePath, { stripTestModules })
    : undefined

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
    throw new Error(
      `Unexpected build output${codeSuffix}. Ensure the package builds correctly.\n${stdout}`
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
  if (!stdout) return

  // Look for the last line that looks like JSON and try to parse it.
  const lines = stdout.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    const candidate = line.trim()
    if (!candidate.startsWith("{")) continue
    try {
      const parsed = JSON.parse(candidate)
      if (
        Array.isArray(parsed?.modules) &&
        Array.isArray(parsed?.dependencies)
      ) {
        return { modules: parsed.modules, dependencies: parsed.dependencies }
      }
    } catch {
      // keep scanning earlier lines
    }
  }

  // Fallback: attempt parsing from the first '{' onward in the whole stdout blob.
  const firstBrace = stdout.indexOf("{")
  if (firstBrace >= 0) {
    try {
      const parsed = JSON.parse(stdout.slice(firstBrace))
      if (
        Array.isArray(parsed?.modules) &&
        Array.isArray(parsed?.dependencies)
      ) {
        return { modules: parsed.modules, dependencies: parsed.dependencies }
      }
    } catch {
      /* ignore */
    }
  }
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

const isTestModuleFilename = (filename: string): boolean => {
  const lowered = filename.toLowerCase()
  return (
    lowered.endsWith("_tests.mv") ||
    lowered.endsWith("_test.mv") ||
    lowered.startsWith("test_")
  )
}

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
