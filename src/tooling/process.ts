import { config } from "dotenv"
config({ quiet: true })

import { basename } from "node:path"
import { fileURLToPath } from "node:url"

import { type Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import {
  getNetworkConfig,
  loadSuiConfig,
  type SuiResolvedConfig
} from "./config.ts"
import { logEachBlue, logError, logKeyValueBlue, logSimpleBlue } from "./log.ts"
import { ensureSuiCli } from "./suiCli.ts"

export type CommonCliArgs = {
  network?: string
}

type ScriptExecutor<TCliArgument> = (
  config: SuiResolvedConfig,
  cliArguments: TCliArgument & CommonCliArgs
) => Promise<void> | void

const stripExt = (name: string): string => name.replace(/\.[^/.]+$/, "")
const fileNameOnly = (fullPath: string): string => stripExt(basename(fullPath))
const currentScriptName = () => {
  // Prefer the entrypoint passed to Node (so pnpm scripts show the actual script name)
  const invokedScript = process.argv?.[1]
  if (invokedScript) return fileNameOnly(invokedScript)

  return fileNameOnly(fileURLToPath(import.meta.url))
}

export type BaseYargs = Argv<CommonCliArgs>

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
      const canonicalKey = aliasToCanonical.get(key) ?? key
      return [canonicalKey, value] as const
    })
    .filter(([canonicalKey]) => {
      if (seenCanonicalKeys.has(canonicalKey)) return false
      seenCanonicalKeys.add(canonicalKey)
      return true
    })

  return Object.fromEntries(filteredEntries)
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
    try {
      await ensureSuiCli()

      const suiConfig = await loadSuiConfig()
      const scriptName = currentScriptName()

      const cliArguments = cliOptions
        ? await addBaseOptions<TCliArgument>(scriptName, cliOptions)
        : undefined

      const networkToLoad = cliArguments?.network || suiConfig.currentNetwork
      const cliArgumentsToLog = sanitizeCliArgumentsForLogging(
        cliArguments,
        cliOptions
      )

      logSimpleBlue("Starting script 🤖")
      logKeyValueBlue("Script")(scriptName)
      logKeyValueBlue("Network")(networkToLoad)
      logEachBlue(cliArgumentsToLog)
      console.log("\n")

      await scriptToExecute(
        {
          ...suiConfig,
          network: getNetworkConfig(
            cliArguments?.network || suiConfig.currentNetwork,
            suiConfig
          )
        },
        cliArguments as CommonCliArgs & TCliArgument
      )
      process.exit(0)
    } catch (error) {
      console.log("\n")
      logError("Script failed ❌")
      logError(
        `${error instanceof Error ? error.message : String(error)}\n${
          error instanceof Error ? error.stack : ""
        }`
      )
      logError(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  })()
}
