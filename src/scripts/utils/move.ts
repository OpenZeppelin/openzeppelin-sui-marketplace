import fs from "node:fs/promises"
import path from "node:path"
import { exitCode } from "node:process"
import { logWarning } from "./log.ts"
import { runSuiCli } from "./suiCli.ts"
import type { BuildOutput } from "./types.ts"

export const buildMovePackage = async (
  packagePath: string,
  buildArguments: string[] = []
): Promise<BuildOutput> => {
  const resolvedPackagePath = path.resolve(packagePath)
  if (!resolvedPackagePath)
    throw new Error(`Contracts not found at ${resolvedPackagePath}`)

  const { stdout, stderr } = await runMoveBuild([
    "--path",
    resolvedPackagePath,
    ...buildArguments
  ])
  if (stderr) logWarning(stderr.trim())

  const { modules, dependencies } = await resolveBuildArtifacts(
    stdout,
    resolvedPackagePath
  )

  if (exitCode !== undefined && exitCode !== 0) {
    logWarning(
      `sui move build returned non-zero exit code (${exitCode}) but JSON output was parsed.`
    )
  }

  return { modules, dependencies }
}

export const runMoveBuild = runSuiCli([
  "move",
  "build",
  "--dump-bytecode-as-base64"
])

const resolveBuildArtifacts = async (
  stdout: string,
  resolvedPackagePath: string
): Promise<BuildOutput> => {
  const parsed = parseBuildJson(stdout)
  const parsedModules = parsed?.modules ?? []
  const parsedDependencies = parsed?.dependencies ?? []
  const fallbackNeeded = parsedModules.length === 0
  const fallback = fallbackNeeded
    ? await readBuildArtifacts(resolvedPackagePath)
    : undefined

  if (fallbackNeeded) {
    logWarning(
      "Build JSON contained no modules; using compiled artifacts from build/ instead."
    )
  }

  const modules = fallbackNeeded ? fallback?.modules || [] : parsedModules
  const dependencies =
    fallbackNeeded && parsedDependencies.length === 0
      ? fallback?.dependencies || []
      : parsedDependencies

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
  resolvedPackagePath: string
): Promise<{ modules: string[]; dependencies: string[] }> => {
  const buildDir = path.join(resolvedPackagePath, "build")
  const packageName = await inferPackageName(buildDir)

  const buildInfoPath = path.join(buildDir, packageName, "BuildInfo.yaml")
  const buildInfoRaw = await fs.readFile(buildInfoPath, "utf8")

  const modules = await readBytecodeModules(buildDir, packageName)
  const dependencies = extractDependencies(buildInfoRaw, packageName)

  return { modules, dependencies }
}

const inferPackageName = async (buildDir: string): Promise<string> => {
  const buildEntries = await fs.readdir(buildDir, { withFileTypes: true })
  return buildEntries.find((entry) => entry.isDirectory())?.name ?? "Pyth"
}

const readBytecodeModules = async (
  buildDir: string,
  packageName: string
): Promise<string[]> => {
  const bytecodeDir = path.join(buildDir, packageName, "bytecode_modules")
  const bytecodeEntries = await fs.readdir(bytecodeDir, {
    withFileTypes: true
  })

  const moduleFiles = bytecodeEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mv"))
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
  // Only consider address aliases listed under `address_alias_instantiation` to
  // avoid accidentally treating fields like `source_digest` as dependencies.
  const addressSectionMatch = buildInfoRaw.match(
    /address_alias_instantiation:\s*\n((?:\s+[A-Za-z0-9_]+\s*:\s*"?[0-9a-fA-F]{64}"?\s*\n)+)/
  )

  const dependenciesBlock = addressSectionMatch?.[1] ?? ""
  const dependencyMatches = [
    ...dependenciesBlock.matchAll(
      /^\s+([A-Za-z0-9_]+)\s*:\s*"?([0-9a-fA-F]{64})"?/gm
    )
  ]

  return dependencyMatches
    .map(([, alias, addr]) => ({ alias, addr }))
    .filter(
      ({ alias }) =>
        alias.toLowerCase() !== packageName.toLowerCase() &&
        alias.toLowerCase() !== "pyth"
    )
    .map(({ addr }) => `0x${addr.toLowerCase()}`)
    .filter((addr, idx, arr) => arr.indexOf(addr) === idx)
}
