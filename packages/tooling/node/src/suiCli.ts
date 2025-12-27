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
        stderr: executionError?.stderr ?? executionError?.message ?? "",
        exitCode:
          typeof executionError?.code === "number"
            ? executionError.code
            : undefined
      }
    }
  }

const runSuiClientCli = runSuiCli(["client"])

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

const parseEnvironmentList = (output: string) => {
  const environments: string[] = []
  let activeEnvironment: string | undefined

  for (const line of output.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    const isActive = trimmedLine.startsWith("*")
    const normalizedLine = trimmedLine.replace(/^\*\s*/, "")
    const environmentName = normalizedLine.split(/\s+/)[0]

    if (!environmentName) continue

    environments.push(environmentName)
    if (isActive && !activeEnvironment) {
      activeEnvironment = environmentName
    }
  }

  return {
    activeEnvironment,
    environments: [...new Set(environments)]
  }
}

/**
 * Returns the active Sui CLI environment name when available.
 */
export const getActiveSuiCliEnvironment = async (): Promise<
  string | undefined
> => {
  const activeEnvResult = await runSuiClientCli(["active-env"])
  if (activeEnvResult.exitCode === 0) {
    const parsed = parseActiveEnvironmentOutput(
      activeEnvResult.stdout.toString()
    )
    if (parsed) return parsed
  }

  const envsResult = await runSuiClientCli(["envs"])
  if (envsResult.exitCode !== 0) return undefined

  return parseEnvironmentList(envsResult.stdout.toString()).activeEnvironment
}

/**
 * Lists available Sui CLI environments.
 */
export const listSuiCliEnvironments = async (): Promise<string[]> => {
  const envsResult = await runSuiClientCli(["envs"])
  if (envsResult.exitCode !== 0) return []

  return parseEnvironmentList(envsResult.stdout.toString()).environments
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
