import { loadSuiConfig, type SuiResolvedConfig } from "./config";
import { logError } from "./log";
import { ensureSuiCli } from "./suiCli";

type ScriptExecutor = (config: SuiResolvedConfig) => Promise<void> | void;

export const runSuiScript = (scriptToExecute: ScriptExecutor) => {
  (async () => {
    try {
      await ensureSuiCli();
      await scriptToExecute(await loadSuiConfig());
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
