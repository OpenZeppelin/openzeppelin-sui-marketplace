import { config } from "dotenv"
config({ quiet: true })

import { basename } from "node:path"
import { fileURLToPath } from "node:url"

import { type Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import type { SuiResolvedConfig } from "./config.ts"
import { getNetworkConfig, loadSuiConfig } from "./config.ts"
import { createSuiClient } from "./describe-object.ts"
import type { Tooling } from "./factory.ts"
import { createTooling } from "./factory.ts"
import {
  logEachBlue,
  logError,
  logKeyValueBlue,
  logSimpleBlue,
  logWarning
} from "./log.ts"
import {
  createSuiCliEnvironment,
  ensureSuiCli,
  getActiveSuiCliEnvironment,
  listSuiCliEnvironments,
  switchSuiCliEnvironment
} from "./suiCli.ts"

export type CommonCliArgs = {
  network?: string
}

type ScriptExecutionContext<TCliArgument> = {
  scriptName: string
  cliArguments?: CommonCliArgs & TCliArgument
  cliArgumentsToLog: Record<string, string | number | boolean | undefined>
  networkName: string
  networkConfig: SuiResolvedConfig["network"]
  suiConfig: SuiResolvedConfig
}

type ScriptExecutor<TCliArgument> = (
  tooling: Tooling,
  cliArguments: TCliArgument & CommonCliArgs
) => Promise<void> | void

/**
 * Removes a file extension from a filename.
 */
const stripExt = (name: string): string => name.replace(/\.[^/.]+$/, "")
/**
 * Returns a file name without its extension.
 */
const fileNameOnly = (fullPath: string): string => stripExt(basename(fullPath))
/**
 * Resolves the current script name for logging and yargs.
 */
const currentScriptName = () => {
  // Prefer the entrypoint passed to Node (so pnpm scripts show the actual script name)
  const invokedScript = process.argv?.[1]
  if (invokedScript) return fileNameOnly(invokedScript)

  return fileNameOnly(fileURLToPath(import.meta.url))
}

export type BaseYargs = Argv<CommonCliArgs>

type SuiCliEnvironmentSwitch = {
  originalEnvironment?: string
  didSwitch: boolean
}

/**
 * Adds the standard `--network` option and parses CLI arguments.
 */
export const addBaseOptions = async <TCliArguments>(
  scriptName: string,
  cliOptions: Argv<TCliArguments>
): Promise<CommonCliArgs & TCliArguments> =>
  (await cliOptions
    .scriptName(scriptName)
    .option("network", {
      alias: "network",
      type: "string",
      description: "Target network"
    })
    .strict()
    .help()
    .parseAsync(hideBin(process.argv))) as CommonCliArgs & TCliArguments

/**
 * Normalizes CLI argument keys for clean logging (dedupes aliases).
 */
const sanitizeCliArgumentsForLogging = <TCliArgument>(
  cliArguments: (TCliArgument & CommonCliArgs) | undefined,
  cliOptions?: Argv<TCliArgument>
): Record<string, string | number | boolean | undefined> => {
  if (!cliArguments) return {}

  const toCamelCase = (value: string): string =>
    value
      .split(/[-_.]/)
      .filter(Boolean)
      .map((part, index) =>
        index === 0
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      )
      .join("")

  const aliasToCanonical = (() => {
    // yargs exposes getOptions at runtime, but the type definition is loose on Argv
    const { alias = {} } =
      (
        cliOptions as Argv<TCliArgument> & {
          getOptions?: () => { alias?: Record<string, string[]> }
        }
      )?.getOptions?.() ?? {}

    const map = new Map<string, string>()
    Object.entries(alias).forEach(([canonical, aliases]) => {
      map.set(canonical, canonical)
      aliases?.forEach((optionAlias) => {
        map.set(optionAlias, canonical)
        map.set(toCamelCase(optionAlias), canonical)
      })
    })

    return map
  })()

  const seenCanonicalKeys = new Set<string>()

  const filteredEntries = Object.entries(cliArguments)
    .filter(([key]) => key !== "_" && key !== "$0")
    .map(([key, value]) => {
      const canonicalKey =
        aliasToCanonical.get(key) ??
        aliasToCanonical.get(toCamelCase(key)) ??
        key
      return [canonicalKey, value] as const
    })
    .filter(([canonicalKey]) => {
      if (seenCanonicalKeys.has(canonicalKey)) return false
      seenCanonicalKeys.add(canonicalKey)
      return true
    })

  return Object.fromEntries(filteredEntries)
}

const resolveNetworkName = (
  cliArguments: CommonCliArgs | undefined,
  suiConfig: SuiResolvedConfig
) => cliArguments?.network || suiConfig.currentNetwork

const buildSuiConfigForNetwork = ({
  suiConfigFromFile,
  networkName,
  networkConfig
}: {
  suiConfigFromFile: SuiResolvedConfig
  networkName: string
  networkConfig: SuiResolvedConfig["network"]
}): SuiResolvedConfig => ({
  ...suiConfigFromFile,
  currentNetwork: networkName,
  network: networkConfig
})

const resolveCliArguments = async <TCliArgument>(
  scriptName: string,
  cliOptions?: Argv<TCliArgument>
): Promise<(CommonCliArgs & TCliArgument) | undefined> => {
  if (!cliOptions) return undefined
  return addBaseOptions<TCliArgument>(scriptName, cliOptions)
}

const resolveScriptNetwork = (
  cliArguments: CommonCliArgs | undefined,
  suiConfigFromFile: SuiResolvedConfig
) => {
  const networkName = resolveNetworkName(cliArguments, suiConfigFromFile)
  const networkConfig = getNetworkConfig(networkName, suiConfigFromFile)

  return { networkName, networkConfig }
}

const buildScriptExecutionContext = async <TCliArgument>(
  cliOptions?: Argv<TCliArgument>
): Promise<ScriptExecutionContext<TCliArgument>> => {
  const suiConfigFromFile = await loadSuiConfig()
  const scriptName = currentScriptName()
  const cliArguments = await resolveCliArguments(scriptName, cliOptions)
  const { networkName, networkConfig } = resolveScriptNetwork(
    cliArguments,
    suiConfigFromFile
  )
  const cliArgumentsToLog = sanitizeCliArgumentsForLogging(
    cliArguments,
    cliOptions
  )

  return {
    scriptName,
    cliArguments,
    cliArgumentsToLog,
    networkName,
    networkConfig,
    suiConfig: buildSuiConfigForNetwork({
      suiConfigFromFile,
      networkName,
      networkConfig
    })
  }
}

const createToolingForNetwork = async (
  networkConfig: SuiResolvedConfig["network"],
  suiConfig: SuiResolvedConfig
) =>
  createTooling({
    suiClient: createSuiClient(networkConfig.url),
    suiConfig
  })

const logScriptStart = (context: ScriptExecutionContext<unknown>) => {
  logSimpleBlue("Starting script 🤖")
  logKeyValueBlue("Script")(context.scriptName)
  logKeyValueBlue("Network")(context.networkName)
  logEachBlue(context.cliArgumentsToLog)
  console.log("")
}

const logScriptFailure = (error: unknown) => {
  console.log("")
  logError("Script failed ❌")
  logError(
    `${error instanceof Error ? error.message : String(error)}\n${
      error instanceof Error ? error.stack : ""
    }`
  )
  logError(`${error instanceof Error ? error.message : String(error)}\n`)
}

const isSuiCliEnvironmentConfigured = (
  environmentName: string,
  availableEnvironments: string[]
) => availableEnvironments.includes(environmentName)

const switchSuiCliEnvironmentIfNeeded = async ({
  environmentName,
  rpcUrl
}: {
  environmentName: string | undefined
  rpcUrl: string | undefined
}): Promise<SuiCliEnvironmentSwitch> => {
  const originalEnvironment = await getActiveSuiCliEnvironment()

  if (!environmentName || originalEnvironment === environmentName) {
    return { originalEnvironment, didSwitch: false }
  }

  const availableEnvironments = await listSuiCliEnvironments()
  const environmentExists = isSuiCliEnvironmentConfigured(
    environmentName,
    availableEnvironments
  )
  let didCreateEnvironment = false

  if (!environmentExists && rpcUrl) {
    didCreateEnvironment = await createSuiCliEnvironment(
      environmentName,
      rpcUrl
    )
    if (!didCreateEnvironment) {
      logWarning(
        `Failed to create Sui CLI environment ${environmentName}; attempting to switch anyway.`
      )
    }
  }

  const shouldAttemptSwitch =
    environmentExists ||
    didCreateEnvironment ||
    availableEnvironments.length === 0

  if (!shouldAttemptSwitch) {
    logWarning(
      `Sui CLI environment ${environmentName} is not configured; CLI commands may target a different network.`
    )
    return { originalEnvironment, didSwitch: false }
  }

  const didSwitch = await switchSuiCliEnvironment(environmentName)
  if (!didSwitch)
    logWarning(
      `Failed to switch Sui CLI environment to ${environmentName}; CLI commands may target a different network.`
    )

  return { originalEnvironment, didSwitch }
}

const restoreSuiCliEnvironment = async (
  switchState: SuiCliEnvironmentSwitch
) => {
  if (!switchState.didSwitch || !switchState.originalEnvironment) return

  const didRestore = await switchSuiCliEnvironment(
    switchState.originalEnvironment
  )
  if (!didRestore) {
    logWarning(
      `Failed to restore Sui CLI environment to ${switchState.originalEnvironment}.`
    )
  }
}

const withSuiCliEnvironment = async <TResult>(
  {
    environmentName,
    rpcUrl
  }: {
    environmentName: string | undefined
    rpcUrl: string | undefined
  },
  action: () => Promise<TResult>
): Promise<TResult> => {
  const environmentSwitch = await switchSuiCliEnvironmentIfNeeded({
    environmentName,
    rpcUrl
  })

  try {
    return await action()
  } finally {
    await restoreSuiCliEnvironment(environmentSwitch)
  }
}

const runScriptAndCaptureExitCode = async <TCliArgument>(
  scriptToExecute: ScriptExecutor<TCliArgument>,
  cliOptions?: Argv<TCliArgument>
): Promise<number> => {
  try {
    await ensureSuiCli()

    const context = await buildScriptExecutionContext(cliOptions)

    return await withSuiCliEnvironment(
      {
        environmentName: context.networkName,
        rpcUrl: context.networkConfig.url
      },
      async () => {
        logScriptStart(context)

        await scriptToExecute(
          await createToolingForNetwork(
            context.networkConfig,
            context.suiConfig
          ),
          context.cliArguments as CommonCliArgs & TCliArgument
        )

        return 0
      }
    )
  } catch (error) {
    logScriptFailure(error)
    return 1
  }
}

const finalizeProcess = (exitCode: number) => {
  if (exitCode === 0) process.exit(0)
  process.exitCode = exitCode
}

/**
 * Thin wrapper around yargs + Sui config loading to run CLI scripts consistently.
 * Why: Centralizes logging, network resolution, and Sui CLI presence so each script
 * behaves like a Hardhat task equivalent in EVM tooling.
 */
export const runSuiScript = <TCliArgument>(
  scriptToExecute: ScriptExecutor<TCliArgument>,
  cliOptions?: Argv<TCliArgument>
) => {
  ;(async () => {
    const exitCode = await runScriptAndCaptureExitCode(
      scriptToExecute,
      cliOptions
    )
    finalizeProcess(exitCode)
  })()
}
