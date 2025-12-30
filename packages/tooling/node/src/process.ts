import { config } from "dotenv"
config({ quiet: true })

import { createHash } from "node:crypto"
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
import { syncLocalnetMoveEnvironmentChainId } from "./move.ts"
import {
  createSuiCliEnvironment,
  ensureSuiCli,
  getActiveSuiCliEnvironment,
  getSuiCliEnvironmentRpc,
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

const syncLocalnetMoveEnvironmentChainIdForTooling = async (
  tooling: Tooling
) => {
  const { chainId, updatedFiles, didAttempt } =
    await syncLocalnetMoveEnvironmentChainId({
      moveRootPath: tooling.suiConfig.paths.move,
      environmentName: tooling.suiConfig.network.networkName,
      suiClient: tooling.suiClient
    })

  if (didAttempt && !chainId) {
    logWarning(
      "Unable to resolve localnet chain id; Move.toml environments were not updated."
    )
  }

  if (updatedFiles.length) {
    logKeyValueBlue("Move.toml")(
      `updated ${updatedFiles.length} localnet environment entries`
    )
  }
}

const isSuiCliEnvironmentConfigured = (
  environmentName: string,
  availableEnvironments: string[]
) => availableEnvironments.includes(environmentName)

const normalizeRpcUrlForComparison = (value: string): string =>
  value.trim().replace(/\/+$/, "")

const hashRpcUrl = (rpcUrl: string): string =>
  createHash("sha256").update(rpcUrl).digest("hex").slice(0, 10)

const addEnvironmentName = (
  environmentName: string,
  availableEnvironments: string[]
): string[] =>
  isSuiCliEnvironmentConfigured(environmentName, availableEnvironments)
    ? availableEnvironments
    : [...availableEnvironments, environmentName]

const ensureSuiCliEnvironmentExists = async ({
  environmentName,
  rpcUrl,
  availableEnvironments
}: {
  environmentName: string
  rpcUrl: string
  availableEnvironments: string[]
}): Promise<{ didEnsure: boolean; availableEnvironments: string[] }> => {
  if (isSuiCliEnvironmentConfigured(environmentName, availableEnvironments)) {
    return { didEnsure: true, availableEnvironments }
  }

  const didCreate = await createSuiCliEnvironment(environmentName, rpcUrl)
  if (!didCreate) return { didEnsure: false, availableEnvironments }

  return {
    didEnsure: true,
    availableEnvironments: addEnvironmentName(
      environmentName,
      availableEnvironments
    )
  }
}

const isSuiCliEnvironmentRpcMatching = async ({
  environmentName,
  expectedRpcUrl
}: {
  environmentName: string
  expectedRpcUrl: string
}): Promise<boolean> => {
  const configuredRpcUrl = await getSuiCliEnvironmentRpc(environmentName)
  if (!configuredRpcUrl) return true

  return (
    normalizeRpcUrlForComparison(configuredRpcUrl) ===
    normalizeRpcUrlForComparison(expectedRpcUrl)
  )
}

const buildTemporaryEnvironmentBaseAlias = (
  baseAlias: string,
  rpcUrl: string
) => `${baseAlias}-rpc-${hashRpcUrl(normalizeRpcUrlForComparison(rpcUrl))}`

const createOrReuseTemporarySuiCliEnvironment = async ({
  baseAlias,
  rpcUrl,
  availableEnvironments
}: {
  baseAlias: string
  rpcUrl: string
  availableEnvironments: string[]
}): Promise<{ environmentName: string; availableEnvironments: string[] }> => {
  const candidateBase = buildTemporaryEnvironmentBaseAlias(baseAlias, rpcUrl)

  const tryEnsureEnvironment = async (
    environmentName: string,
    currentEnvironments: string[]
  ): Promise<{ didEnsure: boolean; availableEnvironments: string[] }> => {
    const exists = isSuiCliEnvironmentConfigured(
      environmentName,
      currentEnvironments
    )
    if (exists) {
      const rpcMatches = await isSuiCliEnvironmentRpcMatching({
        environmentName,
        expectedRpcUrl: rpcUrl
      })
      return {
        didEnsure: rpcMatches,
        availableEnvironments: currentEnvironments
      }
    }

    return ensureSuiCliEnvironmentExists({
      environmentName,
      rpcUrl,
      availableEnvironments: currentEnvironments
    })
  }

  const stableAttempt = await tryEnsureEnvironment(
    candidateBase,
    availableEnvironments
  )
  if (stableAttempt.didEnsure)
    return {
      environmentName: candidateBase,
      availableEnvironments: stableAttempt.availableEnvironments
    }

  let updatedEnvironmentNames = stableAttempt.availableEnvironments

  for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1) {
    const uniqueAlias = `${candidateBase}-${Date.now().toString(36)}-${attemptIndex}`
    const attempt = await tryEnsureEnvironment(
      uniqueAlias,
      updatedEnvironmentNames
    )
    updatedEnvironmentNames = attempt.availableEnvironments
    if (attempt.didEnsure)
      return {
        environmentName: uniqueAlias,
        availableEnvironments: updatedEnvironmentNames
      }
  }

  throw new Error(
    `Unable to create a Sui CLI environment pointing at ${rpcUrl}. ` +
      `Run \`sui client envs --json\` and ensure your environment aliases point to the intended RPC.`
  )
}

const resolveSuiCliEnvironmentForRpcUrl = async ({
  requestedEnvironmentName,
  rpcUrl,
  availableEnvironments
}: {
  requestedEnvironmentName: string
  rpcUrl: string
  availableEnvironments: string[]
}): Promise<{
  environmentName: string
  availableEnvironments: string[]
  didUseTemporaryEnvironment: boolean
}> => {
  const rpcMatches = await isSuiCliEnvironmentRpcMatching({
    environmentName: requestedEnvironmentName,
    expectedRpcUrl: rpcUrl
  })

  if (rpcMatches)
    return {
      environmentName: requestedEnvironmentName,
      availableEnvironments,
      didUseTemporaryEnvironment: false
    }

  const configuredRpcUrl = await getSuiCliEnvironmentRpc(
    requestedEnvironmentName
  )
  logWarning(
    `Sui CLI environment '${requestedEnvironmentName}' points at ${configuredRpcUrl ?? "<unknown>"}, but this script expects ${rpcUrl}. ` +
      `Switching to a temporary environment alias to avoid targeting the wrong network.`
  )

  const temporaryEnvironment = await createOrReuseTemporarySuiCliEnvironment({
    baseAlias: requestedEnvironmentName,
    rpcUrl,
    availableEnvironments
  })

  return {
    environmentName: temporaryEnvironment.environmentName,
    availableEnvironments: temporaryEnvironment.availableEnvironments,
    didUseTemporaryEnvironment: true
  }
}

const switchSuiCliEnvironmentIfNeeded = async ({
  environmentName,
  rpcUrl
}: {
  environmentName: string | undefined
  rpcUrl: string | undefined
}): Promise<SuiCliEnvironmentSwitch> => {
  const originalEnvironment = await getActiveSuiCliEnvironment()

  if (!environmentName) return { originalEnvironment, didSwitch: false }

  const availableEnvironments = await listSuiCliEnvironments()

  const resolvedEnvironment = rpcUrl
    ? await resolveSuiCliEnvironmentForRpcUrl({
        requestedEnvironmentName: environmentName,
        rpcUrl,
        availableEnvironments
      })
    : {
        environmentName,
        availableEnvironments,
        didUseTemporaryEnvironment: false
      }

  const targetEnvironmentName = resolvedEnvironment.environmentName
  const resolvedAvailableEnvironments =
    resolvedEnvironment.availableEnvironments

  if (originalEnvironment === targetEnvironmentName)
    return { originalEnvironment, didSwitch: false }

  const environmentExists = isSuiCliEnvironmentConfigured(
    targetEnvironmentName,
    resolvedAvailableEnvironments
  )
  let didCreateEnvironment = false

  if (!environmentExists && rpcUrl) {
    didCreateEnvironment = (
      await ensureSuiCliEnvironmentExists({
        environmentName: targetEnvironmentName,
        rpcUrl,
        availableEnvironments: resolvedAvailableEnvironments
      })
    ).didEnsure
    if (!didCreateEnvironment) {
      logWarning(
        `Failed to create Sui CLI environment ${targetEnvironmentName}; attempting to switch anyway.`
      )
    }
  }

  const shouldAttemptSwitch =
    environmentExists ||
    didCreateEnvironment ||
    resolvedAvailableEnvironments.length === 0

  if (!shouldAttemptSwitch) {
    logWarning(
      `Sui CLI environment ${targetEnvironmentName} is not configured; CLI commands may target a different network.`
    )
    return { originalEnvironment, didSwitch: false }
  }

  const didSwitch = await switchSuiCliEnvironment(targetEnvironmentName)
  if (!didSwitch)
    logWarning(
      `Failed to switch Sui CLI environment to ${targetEnvironmentName}; CLI commands may target a different network.`
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

        const tooling = await createToolingForNetwork(
          context.networkConfig,
          context.suiConfig
        )

        await syncLocalnetMoveEnvironmentChainIdForTooling(tooling)

        await scriptToExecute(
          tooling,
          context.cliArguments as CommonCliArgs & TCliArgument
        )

        await syncLocalnetMoveEnvironmentChainIdForTooling(tooling)

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
