import yargs, { Argv } from "yargs";
import {
  loadSuiConfig,
  getNetworkConfig,
  type SuiResolvedConfig,
} from "./config";
import { logError } from "./log";
import { ensureSuiCli } from "./suiCli";
import { hideBin } from "yargs/helpers";
import { basename } from "path";

export type CommonCliArgs = {
  network?: string;
};

type ScriptExecutor<TCliArgument> = (
  config: SuiResolvedConfig,
  cliArguments: TCliArgument & CommonCliArgs
) => Promise<void> | void;

const stripExt = (name: string): string => name.replace(/\.[^/.]+$/, "");
const fileNameOnly = (fullPath: string): string => stripExt(basename(fullPath));

export type BaseYargs = Argv<CommonCliArgs>;

export const addBaseOptions = async <TCliArguments>(
  cliOptions: Argv<TCliArguments>
): Promise<CommonCliArgs & TCliArguments> =>
  (await cliOptions
    .scriptName(fileNameOnly(__filename))
    .option("network", {
      alias: "network",
      type: "string",
      description: "Target network",
    })
    .strict()
    .help()
    .parseAsync(hideBin(process.argv))) as CommonCliArgs & TCliArguments;

export const runSuiScript = <TCliArgument>(
  scriptToExecute: ScriptExecutor<TCliArgument>,
  cliOptions?: Argv<TCliArgument>
) => {
  (async () => {
    try {
      await ensureSuiCli();

      const suiConfig = await loadSuiConfig();
      const cliArguments = cliOptions
        ? await addBaseOptions<TCliArgument>(cliOptions)
        : undefined;

      await scriptToExecute(
        {
          ...suiConfig,
          network: getNetworkConfig(
            cliArguments?.network || suiConfig.currentNetwork,
            suiConfig
          ),
        },
        cliArguments as CommonCliArgs & TCliArguments
      );
      process.exit(0);
    } catch (error) {
      console.log("\n");
      logError("Script failed ❌");
      logError(
        `${error instanceof Error ? error.message : String(error)}\n${
          error instanceof Error ? error.stack : ""
        }`
      );
      logError(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  })();
};
