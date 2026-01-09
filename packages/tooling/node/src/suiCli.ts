import type { ExecException, ExecFileOptions } from "node:child_process"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

/**
 * Ensures the Sui CLI is installed and available on PATH.
 */
export const ensureSuiCli = async () => {
  try {
    await execFile("sui", ["--version"])
  } catch {
    throw new Error(
      "The Sui CLI is required but was not found. Install it and ensure `sui` is on your PATH."
    )
  }
}

/**
 * Builds a CLI runner for `sui`, returning stdout/stderr/exitCode even on failure.
 */
export const runSuiCli =
  (baseCliArguments: string[]) =>
  async (
    complementaryCliArguments: string[],
    options: ExecFileOptions = {}
  ) => {
    try {
      const result = await execFile(
        "sui",
        [...baseCliArguments, ...complementaryCliArguments],
        { encoding: "utf-8", ...options }
      )
      return { ...result, exitCode: 0 }
    } catch (error) {
      const executionError = error as ExecException
      // `execFile` rejects on non-zero exit codes. We still want to surface
      // whatever stdout was produced (warnings often go to stdout), so plumb it through.
      return {
        stdout: executionError?.stdout ?? "",
        stderr: `Error running sui ${[...baseCliArguments, ...complementaryCliArguments].join(" ")}: ${executionError?.stderr ?? executionError?.message ?? ""}`,
        exitCode:
          typeof executionError?.code === "number"
            ? executionError.code
            : undefined
      }
    }
  }

const runSuiClientCli = runSuiCli(["client"])
const runSuiCliVersion = runSuiCli([])

export const parseSuiCliVersionOutput = (
  stdout: string
): string | undefined => {
  if (!stdout?.trim()) return undefined
  const firstLine = stdout.trim().split(/\r?\n/)[0] ?? ""
  const versionMatch = firstLine.match(/sui\s+([^\s]+)/i)
  return (versionMatch?.[1] ?? firstLine) || undefined
}

/**
 * Returns the installed Sui CLI version, if available.
 */
export const getSuiCliVersion = async (): Promise<string | undefined> => {
  try {
    const { stdout, exitCode } = await runSuiCliVersion(["--version"])
    if (exitCode && exitCode !== 0) return undefined
    return parseSuiCliVersionOutput(stdout.toString())
  } catch {
    return undefined
  }
}

type SuiCliEnvironmentJsonEntry = {
  alias: string
  rpc?: string
  chain_id?: string
  chainId?: string
}

type SuiCliEnvironmentsJson = [SuiCliEnvironmentJsonEntry[], string | undefined]

const parseActiveEnvironmentOutput = (output: string): string | undefined => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) return undefined

  const explicitMatch = normalizedOutput.match(
    /active\s+environment\s*:\s*([^\s]+)/i
  )
  if (explicitMatch?.[1]) return explicitMatch[1]

  const fallbackMatch = normalizedOutput.match(
    /active\s+env(?:ironment)?\s*:\s*([^\s]+)/i
  )
  if (fallbackMatch?.[1]) return fallbackMatch[1]

  const tokens = normalizedOutput.split(/\s+/)
  return tokens.length > 0 ? tokens[tokens.length - 1] : undefined
}

const parseActiveEnvironmentJson = (output: string): string | undefined => {
  const normalizedOutput = output.trim()
  if (!normalizedOutput) return undefined
  if (!/^["[{]/.test(normalizedOutput)) return undefined

  try {
    const parsed = JSON.parse(normalizedOutput)
    return typeof parsed === "string" ? parsed : undefined
  } catch {
    return undefined
  }
}

const parseEnvironmentTableRow = (
  line: string
): { environmentName: string; isActive: boolean } | undefined => {
  const trimmedLine = line.trim()
  if (!trimmedLine.startsWith("│")) return undefined

  const columns = trimmedLine
    .split("│")
    .map((value) => value.trim())
    .filter(Boolean)

  if (columns.length < 2) return undefined

  const [environmentName, , activeColumn] = columns
  if (!environmentName || environmentName.toLowerCase() === "alias")
    return undefined

  return {
    environmentName,
    isActive: activeColumn === "*"
  }
}

const parseEnvironmentTokenLine = (
  line: string
): { environmentName: string; isActive: boolean } | undefined => {
  const trimmedLine = line.trim()
  if (!trimmedLine) return undefined
  if (trimmedLine.startsWith("│")) return undefined
  if (/^[┌┐└┘├┤┬┴┼╭╮╰╯─]+/.test(trimmedLine)) return undefined

  const isActive = trimmedLine.startsWith("*")
  const normalizedLine = trimmedLine.replace(/^\*\s*/, "")
  const environmentName = normalizedLine.split(/\s+/)[0]

  if (!environmentName || environmentName.toLowerCase() === "alias")
    return undefined

  return { environmentName, isActive }
}

const parseEnvironmentList = (output: string) => {
  const environments: string[] = []
  let activeEnvironment: string | undefined

  for (const line of output.split(/\r?\n/)) {
    const tableRow = parseEnvironmentTableRow(line)
    const tokenRow = tableRow ?? parseEnvironmentTokenLine(line)

    if (!tokenRow) continue

    environments.push(tokenRow.environmentName)
    if (tokenRow.isActive && !activeEnvironment) {
      activeEnvironment = tokenRow.environmentName
    }
  }

  return {
    activeEnvironment,
    environments: [...new Set(environments)]
  }
}

const parseSuiCliEnvironmentsJson = (
  rawOutput: string
): {
  environments: SuiCliEnvironmentJsonEntry[]
  activeEnvironment?: string
} => {
  if (!rawOutput?.trim()) return { environments: [] }

  try {
    const parsed = JSON.parse(rawOutput) as SuiCliEnvironmentsJson
    const environments = Array.isArray(parsed?.[0]) ? parsed[0] : []
    const activeEnvironment =
      typeof parsed?.[1] === "string" ? parsed[1] : undefined
    return { environments, activeEnvironment }
  } catch {
    return { environments: [] }
  }
}

/**
 * Returns the active Sui CLI environment name when available.
 */
export const getActiveSuiCliEnvironment = async (): Promise<
  string | undefined
> => {
  const activeEnvJsonResult = await runSuiClientCli(["active-env", "--json"])
  if (activeEnvJsonResult.exitCode === 0) {
    const parsed = parseActiveEnvironmentJson(
      activeEnvJsonResult.stdout.toString()
    )
    if (parsed) return parsed
  }

  const activeEnvResult = await runSuiClientCli(["active-env"])
  if (activeEnvResult.exitCode === 0) {
    const parsed = parseActiveEnvironmentOutput(
      activeEnvResult.stdout.toString()
    )
    if (parsed) return parsed
  }

  const envsResult = await runSuiClientCli(["envs", "--json"])
  if (envsResult.exitCode === 0) {
    const parsed = parseSuiCliEnvironmentsJson(envsResult.stdout.toString())
    if (parsed.activeEnvironment) return parsed.activeEnvironment
  }

  const envsFallbackResult = await runSuiClientCli(["envs"])
  if (envsFallbackResult.exitCode !== 0) return undefined

  return parseEnvironmentList(envsFallbackResult.stdout.toString())
    .activeEnvironment
}

/**
 * Lists available Sui CLI environments.
 */
export const listSuiCliEnvironments = async (): Promise<string[]> => {
  const envsJsonResult = await runSuiClientCli(["envs", "--json"])
  if (envsJsonResult.exitCode === 0) {
    const parsed = parseSuiCliEnvironmentsJson(envsJsonResult.stdout.toString())
    if (parsed.environments.length) {
      return parsed.environments.map((entry) => entry.alias)
    }
  }

  const envsResult = await runSuiClientCli(["envs"])
  if (envsResult.exitCode !== 0) return []

  return parseEnvironmentList(envsResult.stdout.toString()).environments
}

/**
 * Reads the chain identifier recorded in Sui CLI config for an environment.
 */
export const getSuiCliEnvironmentChainId = async (
  environmentName?: string
): Promise<string | undefined> => {
  const envsResult = await runSuiClientCli(["envs", "--json"])
  if (envsResult.exitCode !== 0) return undefined

  const { environments, activeEnvironment } = parseSuiCliEnvironmentsJson(
    envsResult.stdout.toString()
  )
  const targetEnvironment = environmentName ?? activeEnvironment
  if (!targetEnvironment) return undefined

  const match = environments.find((entry) => entry.alias === targetEnvironment)
  return match?.chain_id ?? match?.chainId
}

/**
 * Reads the RPC URL recorded in Sui CLI config for an environment.
 * Useful to ensure that an env alias like "localnet" actually points at the expected RPC.
 */
export const getSuiCliEnvironmentRpc = async (
  environmentName?: string
): Promise<string | undefined> => {
  const envsResult = await runSuiClientCli(["envs", "--json"])
  if (envsResult.exitCode !== 0) return undefined

  const { environments, activeEnvironment } = parseSuiCliEnvironmentsJson(
    envsResult.stdout.toString()
  )
  const targetEnvironment = environmentName ?? activeEnvironment
  if (!targetEnvironment) return undefined

  const match = environments.find((entry) => entry.alias === targetEnvironment)
  return match?.rpc
}

/**
 * Switches the active Sui CLI environment.
 */
export const switchSuiCliEnvironment = async (
  environmentName: string
): Promise<boolean> => {
  const result = await runSuiClientCli(["switch", "--env", environmentName])
  return result.exitCode === 0
}

/**
 * Creates a Sui CLI environment with an alias and RPC URL.
 */
export const createSuiCliEnvironment = async (
  environmentName: string,
  rpcUrl: string
): Promise<boolean> => {
  const result = await runSuiClientCli([
    "new-env",
    "--alias",
    environmentName,
    "--rpc",
    rpcUrl
  ])
  return result.exitCode === 0
}
