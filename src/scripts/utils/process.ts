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
import { logError, logKeyValueBlue, logSimpleBlue } from "./log.ts"
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

      logSimpleBlue("Starting script 🤖")
      logKeyValueBlue("Script")(scriptName)
      logKeyValueBlue("Network")(networkToLoad)
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
